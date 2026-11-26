import "server-only";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { STATUS_LABELS, type PurchaseStatus } from "@/lib/approval";
import { poLineReceived, poLineReturned, prLineOrdered, rtLineIssued } from "@/lib/purchase-status";
import { todayBangkok, dateOnly } from "@/lib/stock-rules";
import type { ReportRow } from "@/lib/reports";
import { d, dateRangeFilter, dayRange, enumOptions, money, qty, selectFilter, vendorOptions, type ReportDef } from "./common";

/** สถานะที่ถือว่าเป็นยอดซื้อ/ยอดค้างจริง (อนุมัติแล้วขึ้นไป) */
const APPROVED_LIKE: PurchaseStatus[] = ["APPROVED", "PARTIAL", "COMPLETED"];
const OPEN: PurchaseStatus[] = ["APPROVED", "PARTIAL"];
const statusOf = (labels: Record<string, string>, v: string | undefined) => (v && v in labels ? (v as PurchaseStatus) : undefined);

const requests: ReportDef = {
  key: "requests",
  title: "รายการใบขอซื้อ (PR)",
  description: "ใบขอซื้อแยกตามรายการสินค้า พร้อมจำนวนที่สั่งซื้อแล้วและคงค้าง",
  filters: async () => [dateRangeFilter("วันที่ออกเอกสาร"), selectFilter("status", "สถานะ", enumOptions(STATUS_LABELS.PR))],
  run: async (f) => {
    const lines = await prisma.purchaseRequestLine.findMany({
      where: { request: { docDate: dayRange(f), status: statusOf(STATUS_LABELS.PR, f.status) } },
      include: {
        request: { include: { requester: { select: { firstName: true, lastName: true } }, warehouse: true } },
        product: { include: { stockUnit: true } },
      },
      orderBy: [{ request: { docDate: "asc" } }, { request: { docNo: "asc" } }, { lineNo: "asc" }],
    });
    const ordered = await prLineOrdered(prisma, lines.map((l) => l.id));
    return {
      columns: [
        { key: "docNo", header: "เลขที่" },
        { key: "docDate", header: "วันที่ออกเอกสาร" },
        { key: "requiredDate", header: "ต้องการภายใน" },
        { key: "requester", header: "ผู้ขอ" },
        { key: "department", header: "แผนก" },
        { key: "status", header: "สถานะ" },
        { key: "warehouse", header: "คลังปลายทาง" },
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "qty", header: "จำนวนขอซื้อ", type: "number" },
        { key: "ordered", header: "สั่งซื้อแล้ว", type: "number" },
        { key: "remaining", header: "คงค้าง", type: "number" },
        { key: "unit", header: "หน่วย" },
        { key: "note", header: "หมายเหตุ" },
      ],
      rows: lines.map((l) => {
        const q = Number(l.quantity);
        const o = ordered.get(l.id) ?? 0;
        return {
          docNo: l.request.docNo,
          docDate: d(l.request.docDate),
          requiredDate: d(l.request.requiredDate),
          requester: fullName(l.request.requester),
          department: l.request.department,
          status: STATUS_LABELS.PR[l.request.status],
          warehouse: l.request.warehouse?.name ?? null,
          code: l.product.code,
          name: l.product.name,
          qty: qty(q),
          ordered: qty(o),
          remaining: l.request.status === "CANCELLED" ? 0 : qty(Math.max(q - o, 0)),
          unit: l.product.stockUnit?.name ?? "",
          note: l.note,
        };
      }),
    };
  },
};

const orders: ReportDef = {
  key: "orders",
  title: "รายการใบสั่งซื้อ (PO)",
  description: "ใบสั่งซื้อพร้อมผู้ขาย รวมเป็นเงิน VAT และยอดรวมสุทธิ",
  filters: async () => [dateRangeFilter("วันที่ออกเอกสาร"), selectFilter("status", "สถานะ", enumOptions(STATUS_LABELS.PO)), selectFilter("vendor", "ผู้ขาย", await vendorOptions())],
  run: async (f) => {
    const docs = await prisma.purchaseOrder.findMany({
      where: { docDate: dayRange(f), status: statusOf(STATUS_LABELS.PO, f.status), vendorId: f.vendor || undefined },
      include: {
        vendor: { select: { code: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        lines: { select: { requestLine: { select: { request: { select: { docNo: true } } } } } },
      },
      orderBy: [{ docDate: "asc" }, { docNo: "asc" }],
    });
    const rows: ReportRow[] = docs.map((o) => ({
      docNo: o.docNo,
      docDate: d(o.docDate),
      deliveryDate: d(o.deliveryDate),
      vendor: `${o.vendor.code} ${o.vendor.name}`,
      status: STATUS_LABELS.PO[o.status],
      prs: [...new Set(o.lines.map((l) => l.requestLine?.request.docNo).filter(Boolean))].join(", "),
      paymentTerms: o.paymentTerms,
      subtotal: money(o.subtotal.toString()),
      vat: money(o.vatAmount.toString()),
      total: money(o.total.toString()),
      createdBy: fullName(o.createdBy),
    }));
    // ยอดรวมไม่นับใบที่ยกเลิก
    const live = docs.filter((o) => o.status !== "CANCELLED");
    const sum = (k: "subtotal" | "vatAmount" | "total") => money(live.reduce((s, o) => s + Number(o[k]), 0));
    return {
      columns: [
        { key: "docNo", header: "เลขที่" },
        { key: "docDate", header: "วันที่ออกเอกสาร" },
        { key: "deliveryDate", header: "วันที่ส่งของ" },
        { key: "vendor", header: "ผู้ขาย" },
        { key: "status", header: "สถานะ" },
        { key: "prs", header: "อ้างอิงใบขอซื้อ" },
        { key: "paymentTerms", header: "เงื่อนไขการชำระ" },
        { key: "subtotal", header: "รวมเป็นเงิน", type: "number", decimals: 2 },
        { key: "vat", header: "VAT", type: "number", decimals: 2 },
        { key: "total", header: "ยอดรวมสุทธิ", type: "number", decimals: 2 },
        { key: "createdBy", header: "ผู้สร้าง" },
      ],
      rows,
      totals: { docNo: `รวม ${live.length} ใบ (ไม่นับที่ยกเลิก)`, subtotal: sum("subtotal"), vat: sum("vatAmount"), total: sum("total") },
    };
  },
};

const prOpen: ReportDef = {
  key: "pr-open",
  title: "ใบขอซื้อที่ยังไม่ได้สั่งซื้อ",
  description: "รายการใบขอซื้อที่อนุมัติแล้วแต่ยังสั่งซื้อไม่ครบ (นับใบสั่งซื้อที่ยังไม่ยกเลิก)",
  filters: async () => [dateRangeFilter("วันที่ออกเอกสาร", true)],
  run: async (f) => {
    const lines = await prisma.purchaseRequestLine.findMany({
      where: { request: { docDate: dayRange(f), status: { in: OPEN } } },
      include: {
        request: { include: { requester: { select: { firstName: true, lastName: true } } } },
        product: { include: { stockUnit: true } },
      },
      orderBy: [{ request: { requiredDate: { sort: "asc", nulls: "last" } } }, { request: { docNo: "asc" } }, { lineNo: "asc" }],
    });
    const ordered = await prLineOrdered(prisma, lines.map((l) => l.id));
    const today = dateOnly(todayBangkok()).getTime();
    const rows = lines
      .map((l) => ({ l, q: Number(l.quantity), o: ordered.get(l.id) ?? 0 }))
      .filter((x) => x.q - x.o > 0)
      .map(({ l, q, o }) => ({
        docNo: l.request.docNo,
        docDate: d(l.request.docDate),
        requiredDate: d(l.request.requiredDate),
        overdue: l.request.requiredDate && l.request.requiredDate.getTime() < today ? Math.round((today - l.request.requiredDate.getTime()) / 86400_000) : null,
        requester: fullName(l.request.requester),
        status: STATUS_LABELS.PR[l.request.status],
        code: l.product.code,
        name: l.product.name,
        qty: qty(q),
        ordered: qty(o),
        remaining: qty(q - o),
        unit: l.product.stockUnit?.name ?? "",
      }));
    return {
      columns: [
        { key: "docNo", header: "เลขที่" },
        { key: "docDate", header: "วันที่ออกเอกสาร" },
        { key: "requiredDate", header: "ต้องการภายใน" },
        { key: "overdue", header: "เกินกำหนด (วัน)", type: "number" },
        { key: "requester", header: "ผู้ขอ" },
        { key: "status", header: "สถานะ" },
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "qty", header: "จำนวนขอซื้อ", type: "number" },
        { key: "ordered", header: "สั่งซื้อแล้ว", type: "number" },
        { key: "remaining", header: "คงค้าง", type: "number" },
        { key: "unit", header: "หน่วย" },
      ],
      rows,
      totals: { docNo: `รวม ${new Set(rows.map((r) => r.docNo)).size} ใบ ${rows.length} รายการ` },
    };
  },
};

const poOpen: ReportDef = {
  key: "po-open",
  title: "ใบสั่งซื้อที่ยังไม่ได้รับของ",
  description: "รายการใบสั่งซื้อที่อนุมัติแล้วแต่ยังนำเข้าไม่ครบ (นับใบนำเข้าที่นำเข้าแล้ว)",
  filters: async () => [dateRangeFilter("วันที่ออกเอกสาร", true), selectFilter("vendor", "ผู้ขาย", await vendorOptions())],
  run: async (f) => {
    const lines = await prisma.purchaseOrderLine.findMany({
      where: { order: { docDate: dayRange(f), status: { in: OPEN }, vendorId: f.vendor || undefined } },
      include: { order: { include: { vendor: { select: { code: true, name: true } } } }, product: { include: { stockUnit: true } } },
      orderBy: [{ order: { deliveryDate: { sort: "asc", nulls: "last" } } }, { order: { docNo: "asc" } }, { lineNo: "asc" }],
    });
    const received = await poLineReceived(prisma, lines.map((l) => l.id));
    const today = dateOnly(todayBangkok()).getTime();
    const rows = lines
      .map((l) => ({ l, q: Number(l.quantity), r: received.get(l.id) ?? 0 }))
      .filter((x) => x.q - x.r > 0)
      .map(({ l, q, r }) => ({
        docNo: l.order.docNo,
        docDate: d(l.order.docDate),
        deliveryDate: d(l.order.deliveryDate),
        overdue: l.order.deliveryDate && l.order.deliveryDate.getTime() < today ? Math.round((today - l.order.deliveryDate.getTime()) / 86400_000) : null,
        vendor: `${l.order.vendor.code} ${l.order.vendor.name}`,
        status: STATUS_LABELS.PO[l.order.status],
        code: l.product.code,
        name: l.product.name,
        qty: qty(q),
        received: qty(r),
        remaining: qty(q - r),
        unit: l.product.stockUnit?.name ?? "",
        remainingAmount: money((Number(l.amount) * (q - r)) / q),
      }));
    return {
      columns: [
        { key: "docNo", header: "เลขที่" },
        { key: "docDate", header: "วันที่ออกเอกสาร" },
        { key: "deliveryDate", header: "วันที่ส่งของ" },
        { key: "overdue", header: "เกินกำหนด (วัน)", type: "number" },
        { key: "vendor", header: "ผู้ขาย" },
        { key: "status", header: "สถานะ" },
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "qty", header: "จำนวนสั่ง", type: "number" },
        { key: "received", header: "นำเข้าแล้ว", type: "number" },
        { key: "remaining", header: "คงค้าง", type: "number" },
        { key: "unit", header: "หน่วย" },
        { key: "remainingAmount", header: "มูลค่าคงค้าง (ตามราคารายการ)", type: "number", decimals: 2 },
      ],
      rows,
      totals: { docNo: `รวม ${new Set(rows.map((r) => r.docNo)).size} ใบ ${rows.length} รายการ`, remainingAmount: money(rows.reduce((s, r) => s + Number(r.remainingAmount ?? 0), 0)) },
    };
  },
};

const returns: ReportDef = {
  key: "returns",
  title: "รายการใบส่งคืน",
  description: "ใบส่งคืนสินค้าให้ผู้ขาย แยกตามรายการ พร้อมจำนวนที่นำออกแล้ว",
  filters: async () => [dateRangeFilter("วันที่ออกเอกสาร"), selectFilter("status", "สถานะ", enumOptions(STATUS_LABELS.RT)), selectFilter("vendor", "ผู้ขาย", await vendorOptions())],
  run: async (f) => {
    const lines = await prisma.purchaseReturnLine.findMany({
      where: { purchaseReturn: { docDate: dayRange(f), status: statusOf(STATUS_LABELS.RT, f.status), vendorId: f.vendor || undefined } },
      include: {
        purchaseReturn: { include: { vendor: { select: { code: true, name: true } }, order: { select: { docNo: true } }, reason: true } },
        product: { include: { stockUnit: true } },
      },
      orderBy: [{ purchaseReturn: { docDate: "asc" } }, { purchaseReturn: { docNo: "asc" } }, { lineNo: "asc" }],
    });
    const issued = await rtLineIssued(prisma, lines.map((l) => l.id));
    const rows = lines.map((l) => ({
      docNo: l.purchaseReturn.docNo,
      docDate: d(l.purchaseReturn.docDate),
      po: l.purchaseReturn.order.docNo,
      vendor: `${l.purchaseReturn.vendor.code} ${l.purchaseReturn.vendor.name}`,
      reason: l.purchaseReturn.reason.label,
      status: STATUS_LABELS.RT[l.purchaseReturn.status],
      code: l.product.code,
      name: l.product.name,
      qty: qty(l.quantity.toString()),
      issued: qty(issued.get(l.id) ?? 0),
      unit: l.product.stockUnit?.name ?? "",
      note: l.note,
    }));
    return {
      columns: [
        { key: "docNo", header: "เลขที่" },
        { key: "docDate", header: "วันที่ออกเอกสาร" },
        { key: "po", header: "ใบสั่งซื้อ" },
        { key: "vendor", header: "ผู้ขาย" },
        { key: "reason", header: "เหตุผลการคืน" },
        { key: "status", header: "สถานะ" },
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "qty", header: "จำนวนคืน", type: "number" },
        { key: "issued", header: "นำออกแล้ว", type: "number" },
        { key: "unit", header: "หน่วย" },
        { key: "note", header: "หมายเหตุ" },
      ],
      rows,
      totals: { docNo: `รวม ${new Set(rows.map((r) => r.docNo)).size} ใบ` },
    };
  },
};

const byVendor: ReportDef = {
  key: "by-vendor",
  title: "ยอดซื้อตามผู้ขาย",
  description: "ยอดซื้อรวมต่อผู้ขาย จากใบสั่งซื้อที่อนุมัติแล้ว (รวมที่นำเข้าแล้วบางส่วน/ครบ) ตามวันที่ออกเอกสาร",
  filters: async () => [dateRangeFilter("วันที่ออกเอกสาร")],
  run: async (f) => {
    const groups = await prisma.purchaseOrder.groupBy({
      by: ["vendorId"],
      where: { docDate: dayRange(f), status: { in: APPROVED_LIKE } },
      _count: { _all: true },
      _sum: { subtotal: true, vatAmount: true, total: true },
    });
    const vendors = await prisma.contact.findMany({ where: { id: { in: groups.map((g) => g.vendorId) } }, select: { id: true, code: true, name: true } });
    const vm = new Map(vendors.map((v) => [v.id, v]));
    // มูลค่าที่ส่งคืน (ตามใบส่งคืนที่ยังไม่ยกเลิก) คิดตามราคาต่อหน่วยหลังส่วนลดของรายการ PO
    const lines = await prisma.purchaseOrderLine.findMany({
      where: { order: { docDate: dayRange(f), status: { in: APPROVED_LIKE } } },
      select: { id: true, quantity: true, amount: true, order: { select: { vendorId: true } } },
    });
    const returned = await poLineReturned(prisma, lines.map((l) => l.id));
    const returnedByVendor = new Map<string, number>();
    for (const l of lines) {
      const r = returned.get(l.id);
      if (!r) continue;
      returnedByVendor.set(l.order.vendorId, (returnedByVendor.get(l.order.vendorId) ?? 0) + (Number(l.amount) * r) / Number(l.quantity));
    }
    const rows = groups
      .map((g) => {
        const v = vm.get(g.vendorId);
        return {
          code: v?.code ?? "",
          vendor: v?.name ?? "",
          count: g._count._all,
          subtotal: money(g._sum.subtotal?.toString() ?? 0),
          vat: money(g._sum.vatAmount?.toString() ?? 0),
          total: money(g._sum.total?.toString() ?? 0),
          returned: money(returnedByVendor.get(g.vendorId) ?? 0),
        };
      })
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    const sum = (k: "count" | "subtotal" | "vat" | "total" | "returned") => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    return {
      columns: [
        { key: "code", header: "รหัสผู้ขาย" },
        { key: "vendor", header: "ผู้ขาย" },
        { key: "count", header: "จำนวนใบสั่งซื้อ", type: "number" },
        { key: "subtotal", header: "รวมเป็นเงิน", type: "number", decimals: 2 },
        { key: "vat", header: "VAT", type: "number", decimals: 2 },
        { key: "total", header: "ยอดรวมสุทธิ", type: "number", decimals: 2 },
        { key: "returned", header: "มูลค่าส่งคืน (ตามราคารายการ)", type: "number", decimals: 2 },
      ],
      rows,
      totals: { code: "รวม", count: sum("count"), subtotal: money(sum("subtotal")), vat: money(sum("vat")), total: money(sum("total")), returned: money(sum("returned")) },
    };
  },
};

export const PURCHASE_REPORTS: ReportDef[] = [requests, orders, prOpen, poOpen, returns, byVendor];
