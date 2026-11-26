import "server-only";
import { prisma } from "@/lib/db";
import { bangkokLocalToDate } from "@/lib/date-input";
import { formatDateTime } from "@/lib/format";
import { ISSUE_STATUS_LABELS, ISSUE_TYPE_LABELS, MOVEMENT_TYPE_LABELS, RECEIPT_STATUS_LABELS, RECEIPT_TYPE_LABELS, todayBangkok, type StockDocStatus } from "@/lib/stock-rules";
import type { ReportRow } from "@/lib/reports";
import type { GoodsIssueType, GoodsReceiptType } from "@/generated/prisma/enums";
import { d, dateRangeFilter, dayRange, enumOptions, isoParam, locationLabeler, productOptions, qty, selectFilter, timeRange, warehouseOptions, type ReportDef } from "./common";

const statusOf = <T extends string>(labels: Record<T, string>, v: string | undefined) => (v && v in labels ? (v as T) : undefined);

/** สิ้นวัน (เวลาไทย) ของ YYYY-MM-DD — ใช้เป็น occurredAt < ค่านี้ */
const endOfDay = (iso: string) => new Date(bangkokLocalToDate(`${iso}T00:00`)!.getTime() + 24 * 3600_000);

const onHand: ReportDef = {
  key: "on-hand",
  title: "สินค้าคงคลังตามคลัง/สถานที่",
  description: "ยอดคงเหลือ ณ วันที่เลือก แยกตามคลังและสถานที่ (หรือรวมต่อสินค้า) คำนวณจาก stock movement",
  filters: async () => [
    { id: "asOf", type: "date", label: "ณ วันที่" },
    selectFilter("warehouse", "คลัง", await warehouseOptions()),
    {
      id: "view",
      type: "select",
      label: "มุมมอง",
      required: true,
      defaultValue: "location",
      options: [
        { value: "location", label: "แยกตามคลัง/สถานที่" },
        { value: "product", label: "รวมต่อสินค้า" },
      ],
    },
  ],
  run: async (f) => {
    const asOf = isoParam(f.asOf) ?? todayBangkok();
    const byProduct = f.view === "product";
    const groups = await prisma.stockMovement.groupBy({
      by: byProduct ? ["productId"] : ["productId", "warehouseId", "locationId"],
      where: { occurredAt: { lt: endOfDay(asOf) }, warehouseId: f.warehouse || undefined },
      _sum: { quantity: true },
    });
    const nonZero = groups.filter((g) => Number(g._sum.quantity ?? 0) !== 0);
    const [products, warehouses, loc] = await Promise.all([
      prisma.product.findMany({ where: { id: { in: [...new Set(nonZero.map((g) => g.productId))] } }, include: { stockUnit: true } }),
      prisma.stockLocation.findMany({ where: { level: 0 } }),
      locationLabeler(),
    ]);
    const pm = new Map(products.map((p) => [p.id, p]));
    const wm = new Map(warehouses.map((w) => [w.id, w.name]));
    const rows: ReportRow[] = nonZero
      .map((g) => {
        const p = pm.get(g.productId);
        const wh = "warehouseId" in g ? (g.warehouseId as string) : null;
        const lc = "locationId" in g ? (g.locationId as string | null) : null;
        return {
          warehouse: wh ? (wm.get(wh) ?? "") : null,
          location: wh ? loc(wh, lc) : null,
          code: p?.code ?? "",
          name: p?.name ?? "",
          unit: p?.stockUnit?.name ?? "",
          qty: qty(g._sum.quantity?.toString()),
        };
      })
      .sort((a, b) => (a.warehouse ?? "").localeCompare(b.warehouse ?? "", "th") || (a.location ?? "").localeCompare(b.location ?? "", "th") || a.code.localeCompare(b.code));
    return {
      columns: [
        ...(byProduct ? [] : [{ key: "warehouse", header: "คลัง" }, { key: "location", header: "สถานที่" }]),
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "qty", header: `คงเหลือ ณ ${d(new Date(`${asOf}T00:00:00Z`))}`, type: "number" },
        { key: "unit", header: "หน่วย" },
      ],
      rows,
    };
  },
};

const stockCard: ReportDef = {
  key: "stock-card",
  title: "ความเคลื่อนไหวสินค้า (Stock card)",
  description: "ยอดยกมา รับเข้า จ่ายออก และคงเหลือสะสม ต่อสินค้า ในช่วงวันที่",
  filters: async () => [dateRangeFilter("วันที่เคลื่อนไหว"), selectFilter("product", "สินค้า", await productOptions(), "ทุกสินค้า"), selectFilter("warehouse", "คลัง", await warehouseOptions())],
  run: async (f) => {
    const range = timeRange(f);
    const base = { productId: f.product || undefined, warehouseId: f.warehouse || undefined };
    const [moves, opening, loc] = await Promise.all([
      prisma.stockMovement.findMany({
        where: { ...base, occurredAt: range },
        include: { product: { include: { stockUnit: true } }, warehouse: true, serial: { select: { barcode: true } } },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
      range?.gte
        ? prisma.stockMovement.groupBy({ by: ["productId"], where: { ...base, occurredAt: { lt: range.gte } }, _sum: { quantity: true } })
        : Promise.resolve([] as { productId: string; _sum: { quantity: unknown } }[]),
      locationLabeler(),
    ]);
    const open = new Map(opening.map((o) => [o.productId, Number(o._sum.quantity ?? 0)]));
    const productIds = new Set(moves.map((m) => m.productId));
    if (f.product) productIds.add(f.product);
    const products = await prisma.product.findMany({ where: { id: { in: [...productIds] } }, include: { stockUnit: true }, orderBy: { code: "asc" } });

    const rows: ReportRow[] = [];
    for (const p of products) {
      let bal = open.get(p.id) ?? 0;
      let tin = 0;
      let tout = 0;
      const unit = p.stockUnit?.name ?? "";
      rows.push({ code: p.code, name: p.name, date: null, docNo: null, type: "ยอดยกมา", warehouse: null, location: null, barcode: null, lot: null, in: null, out: null, balance: qty(bal), unit });
      for (const m of moves.filter((x) => x.productId === p.id)) {
        const q = Number(m.quantity);
        bal += q;
        if (q > 0) tin += q;
        else tout -= q;
        rows.push({
          code: p.code,
          name: p.name,
          date: formatDateTime(m.occurredAt),
          docNo: m.refDocNo,
          type: MOVEMENT_TYPE_LABELS[m.type],
          warehouse: m.warehouse.name,
          location: loc(m.warehouseId, m.locationId),
          barcode: m.serial.barcode,
          lot: m.lot,
          in: q > 0 ? qty(q) : null,
          out: q < 0 ? qty(-q) : null,
          balance: qty(bal),
          unit,
        });
      }
      rows.push({ code: p.code, name: p.name, date: null, docNo: null, type: "ยอดคงเหลือ", warehouse: null, location: null, barcode: null, lot: null, in: qty(tin), out: qty(tout), balance: qty(bal), unit });
    }
    return {
      columns: [
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "date", header: "วันเวลา" },
        { key: "docNo", header: "เลขที่เอกสาร" },
        { key: "type", header: "รายการ" },
        { key: "warehouse", header: "คลัง" },
        { key: "location", header: "สถานที่" },
        { key: "barcode", header: "Barcode/SN" },
        { key: "lot", header: "Lot" },
        { key: "in", header: "รับเข้า", type: "number" },
        { key: "out", header: "จ่ายออก", type: "number" },
        { key: "balance", header: "คงเหลือ", type: "number" },
        { key: "unit", header: "หน่วย" },
      ],
      rows,
    };
  },
};

const receipts: ReportDef = {
  key: "receipts",
  title: "รายการนำเข้า",
  description: "ใบนำเข้าแยกตามรายการสินค้า (จำนวน SN และจำนวนรวม)",
  filters: async () => [
    dateRangeFilter("วันที่เอกสาร"),
    selectFilter("status", "สถานะ", enumOptions(RECEIPT_STATUS_LABELS)),
    selectFilter("type", "ประเภท", enumOptions(RECEIPT_TYPE_LABELS)),
    selectFilter("warehouse", "คลัง", await warehouseOptions()),
  ],
  run: async (f) => {
    const [lines, loc] = await Promise.all([
      prisma.goodsReceiptLine.findMany({
        where: {
          receipt: {
            docDate: dayRange(f),
            status: statusOf<StockDocStatus>(RECEIPT_STATUS_LABELS, f.status),
            type: statusOf<GoodsReceiptType>(RECEIPT_TYPE_LABELS, f.type),
            warehouseId: f.warehouse || undefined,
          },
        },
        include: {
          receipt: { include: { warehouse: true, order: { select: { docNo: true } } } },
          product: { include: { stockUnit: true } },
          serials: { select: { initialQty: true } },
        },
        orderBy: [{ receipt: { docDate: "asc" } }, { receipt: { docNo: "asc" } }, { lineNo: "asc" }],
      }),
      locationLabeler(),
    ]);
    const rows = lines.map((l) => ({
      docNo: l.receipt.docNo,
      docDate: d(l.receipt.docDate),
      type: RECEIPT_TYPE_LABELS[l.receipt.type],
      po: l.receipt.order?.docNo ?? null,
      status: RECEIPT_STATUS_LABELS[l.receipt.status],
      warehouse: l.receipt.warehouse.name,
      location: l.locationId ? loc(l.receipt.warehouseId, l.locationId) : null,
      lot: l.receipt.lot,
      code: l.product.code,
      name: l.product.name,
      serials: l.serials.length,
      qty: qty(l.serials.reduce((s, x) => s + Number(x.initialQty), 0)),
      unit: l.product.stockUnit?.name ?? "",
      postedAt: l.receipt.postedAt ? formatDateTime(l.receipt.postedAt) : null,
    }));
    return {
      columns: [
        { key: "docNo", header: "เลขที่" },
        { key: "docDate", header: "วันที่" },
        { key: "type", header: "ประเภท" },
        { key: "po", header: "ใบสั่งซื้อ" },
        { key: "status", header: "สถานะ" },
        { key: "warehouse", header: "คลัง" },
        { key: "location", header: "สถานที่" },
        { key: "lot", header: "Lot" },
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "serials", header: "จำนวน SN", type: "number" },
        { key: "qty", header: "จำนวน", type: "number" },
        { key: "unit", header: "หน่วย" },
        { key: "postedAt", header: "นำเข้าเมื่อ" },
      ],
      rows,
      totals: { docNo: `รวม ${new Set(rows.map((r) => r.docNo)).size} ใบ`, serials: rows.reduce((s, r) => s + r.serials, 0) },
    };
  },
};

const issues: ReportDef = {
  key: "issues",
  title: "รายการนำออก",
  description: "ใบนำออกแยกตาม SN ที่นำออก",
  filters: async () => [dateRangeFilter("วันที่เอกสาร"), selectFilter("status", "สถานะ", enumOptions(ISSUE_STATUS_LABELS)), selectFilter("type", "ประเภท", enumOptions(ISSUE_TYPE_LABELS))],
  run: async (f) => {
    const lines = await prisma.goodsIssueLine.findMany({
      where: {
        issue: {
          docDate: dayRange(f),
          status: statusOf<StockDocStatus>(ISSUE_STATUS_LABELS, f.status),
          type: statusOf<GoodsIssueType>(ISSUE_TYPE_LABELS, f.type),
        },
      },
      include: {
        issue: { include: { contact: { select: { name: true } }, purchaseReturn: { select: { docNo: true } } } },
        product: { include: { stockUnit: true } },
        serial: { select: { barcode: true, lot: true, warehouse: { select: { name: true } } } },
      },
      orderBy: [{ issue: { docDate: "asc" } }, { issue: { docNo: "asc" } }, { lineNo: "asc" }],
    });
    const rows = lines.map((l) => ({
      docNo: l.issue.docNo,
      docDate: d(l.issue.docDate),
      type: ISSUE_TYPE_LABELS[l.issue.type],
      recipient: l.issue.contact?.name ?? l.issue.recipientName,
      rt: l.issue.purchaseReturn?.docNo ?? null,
      status: ISSUE_STATUS_LABELS[l.issue.status],
      warehouse: l.serial.warehouse?.name ?? null,
      barcode: l.serial.barcode,
      lot: l.serial.lot,
      code: l.product.code,
      name: l.product.name,
      qty: qty(l.quantity.toString()),
      unit: l.product.stockUnit?.name ?? "",
      postedAt: l.issue.postedAt ? formatDateTime(l.issue.postedAt) : null,
    }));
    return {
      columns: [
        { key: "docNo", header: "เลขที่" },
        { key: "docDate", header: "วันที่" },
        { key: "type", header: "ประเภท" },
        { key: "recipient", header: "ลูกค้า/ผู้รับ" },
        { key: "rt", header: "ใบส่งคืน" },
        { key: "status", header: "สถานะ" },
        { key: "warehouse", header: "คลัง" },
        { key: "barcode", header: "Barcode/SN" },
        { key: "lot", header: "Lot" },
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "qty", header: "จำนวน", type: "number" },
        { key: "unit", header: "หน่วย" },
        { key: "postedAt", header: "นำออกเมื่อ" },
      ],
      rows,
      totals: { docNo: `รวม ${new Set(rows.map((r) => r.docNo)).size} ใบ` },
    };
  },
};

const serials: ReportDef = {
  key: "serials",
  title: "รายการ SN/Lot",
  description: "Barcode/SN ที่นำเข้าคลังแล้ว พร้อม Lot ที่เก็บ จำนวนรับ และคงเหลือปัจจุบัน",
  filters: async () => [
    dateRangeFilter("วันที่นำเข้า (วันที่ใบนำเข้า)", true),
    selectFilter("product", "สินค้า", await productOptions(), "ทุกสินค้า"),
    selectFilter("warehouse", "คลัง", await warehouseOptions()),
    selectFilter("balance", "คงเหลือ", [
      { value: "remaining", label: "เฉพาะที่ยังมีคงเหลือ" },
      { value: "empty", label: "เฉพาะที่หมดแล้ว" },
    ]),
  ],
  run: async (f) => {
    const [list, loc] = await Promise.all([
      prisma.stockSerial.findMany({
        where: {
          productId: f.product || undefined,
          warehouseId: f.warehouse || undefined,
          receiptLine: { receipt: { status: "POSTED", docDate: dayRange(f) } },
        },
        include: { product: { include: { stockUnit: true } }, warehouse: true, receiptLine: { select: { receipt: { select: { docNo: true, docDate: true } } } } },
        orderBy: { barcode: "asc" },
      }),
      locationLabeler(),
    ]);
    const bal = list.length
      ? new Map(
          (
            await prisma.stockMovement.groupBy({ by: ["serialId"], where: { serialId: { in: list.map((s) => s.id) } }, _sum: { quantity: true } })
          ).map((g) => [g.serialId, Number(g._sum.quantity ?? 0)]),
        )
      : new Map<string, number>();
    const rows = list
      .map((s) => ({
        barcode: s.barcode,
        code: s.product.code,
        name: s.product.name,
        lot: s.lot,
        warehouse: s.warehouse?.name ?? null,
        location: loc(s.warehouseId, s.locationId),
        gr: s.receiptLine.receipt.docNo,
        receivedDate: d(s.receiptLine.receipt.docDate),
        initialQty: qty(s.initialQty.toString()),
        balance: qty(bal.get(s.id) ?? 0),
        unit: s.product.stockUnit?.name ?? "",
      }))
      .filter((r) => (f.balance === "remaining" ? (r.balance ?? 0) > 0 : f.balance === "empty" ? (r.balance ?? 0) <= 0 : true));
    return {
      columns: [
        { key: "barcode", header: "Barcode/SN" },
        { key: "code", header: "รหัสสินค้า" },
        { key: "name", header: "ชื่อสินค้า" },
        { key: "lot", header: "Lot" },
        { key: "warehouse", header: "คลัง" },
        { key: "location", header: "สถานที่" },
        { key: "gr", header: "ใบนำเข้า" },
        { key: "receivedDate", header: "วันที่นำเข้า" },
        { key: "initialQty", header: "จำนวนรับ", type: "number" },
        { key: "balance", header: "คงเหลือ", type: "number" },
        { key: "unit", header: "หน่วย" },
      ],
      rows,
      totals: { barcode: `รวม ${rows.length} SN` },
    };
  },
};

export const INVENTORY_REPORTS: ReportDef[] = [onHand, stockCard, receipts, issues, serials];
