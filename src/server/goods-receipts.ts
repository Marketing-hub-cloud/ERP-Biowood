import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { allocateDocNumber, DOC_PREFIXES } from "@/lib/doc-number";
import { formatDate, formatNumber } from "@/lib/format";
import { cancelReceipt, isInWarehouse, postReceipt, STOCK_TX } from "@/lib/stock-ledger";
import { dateOnly, planSerials, RECEIPT_STATUS_LABELS, RECEIPT_TYPE_LABELS, sumQty } from "@/lib/stock-rules";
import { pathLabel, type TreeNode } from "@/lib/tree";
import type { ReceiptData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import { kickNotificationWorker } from "@/lib/notification-worker";
import type { Prisma } from "@/generated/prisma/client";

export const ENTITY_RECEIPT = "GoodsReceipt";

export const receiptInclude = {
  warehouse: true,
  order: { select: { id: true, docNo: true, vendor: { select: { name: true } } } },
  createdBy: { select: { firstName: true, lastName: true } },
  postedBy: { select: { firstName: true, lastName: true } },
  cancelledBy: { select: { firstName: true, lastName: true } },
  lines: {
    orderBy: { lineNo: "asc" },
    include: {
      product: { include: { stockUnit: true } },
      location: true,
      serials: { orderBy: { seq: "asc" } },
    },
  },
} satisfies Prisma.GoodsReceiptInclude;
export type ReceiptFull = Prisma.GoodsReceiptGetPayload<{ include: typeof receiptInclude }>;

export async function getReceiptOr404(id: string) {
  const r = await prisma.goodsReceipt.findUnique({ where: { id }, include: receiptInclude });
  if (!r) throw new ApiError(404, "ไม่พบใบนำเข้า");
  return r;
}

/** ค่าที่อ่านได้สำหรับ audit log */
async function snapshot(tx: TxClient, id: string) {
  // ภายใน transaction ใช้ connection เดียว: query ทีละคำสั่ง
  const r = await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: receiptInclude });
  const nodes = await tx.stockLocation.findMany();
  return {
    type: RECEIPT_TYPE_LABELS[r.type],
    docDate: formatDate(r.docDate),
    warehouse: r.warehouse.name,
    purchaseOrder: r.order?.docNo ?? null,
    lot: r.lot,
    note: r.note,
    status: RECEIPT_STATUS_LABELS[r.status],
    lines: r.lines.map((l) => {
      const qty = sumQty(l.serials.map((s) => s.initialQty.toString()));
      const loc = l.locationId ? pathLabel(nodes as TreeNode[], l.locationId) : "-";
      return `${l.product.code} ${l.product.name} × ${formatNumber(qty, undefined)} ${l.product.stockUnit?.name ?? ""} @ ${loc} (${l.serials.length} SN)`.trim();
    }),
  };
}
/** snapshot สำหรับ audit (ใช้กับสคริปต์ import ยอดยกมา) */
export const receiptSnapshot = snapshot;

/** ประเภทสั่งซื้อ: PO ต้องอนุมัติแล้วและยังรับไม่ครบ (ใบเดิมที่อ้าง PO นี้อยู่แล้วแก้ต่อได้) และทุกรายการมาจาก PO นี้ */
async function assertOrderLines(tx: TxClient, d: ReceiptData, currentOrderId?: string | null) {
  const po = d.purchaseOrderId ? await tx.purchaseOrder.findUnique({ where: { id: d.purchaseOrderId }, include: { lines: true } }) : null;
  const okStatus = po && (po.status === "APPROVED" || po.status === "PARTIAL" || (po.status === "COMPLETED" && po.id === currentOrderId));
  if (!po || !okStatus) throw new ApiError(400, "ใบสั่งซื้อนี้ยังไม่อนุมัติ ถูกยกเลิก หรือนำเข้าครบแล้ว", { purchaseOrderId: "ใบสั่งซื้อไม่ถูกต้อง" });
  const fields: Record<string, string> = {};
  d.lines.forEach((l, i) => {
    const ol = po.lines.find((x) => x.id === l.orderLineId);
    if (!ol || ol.productId !== l.productId) fields[`lines.${i}.productId`] = "รายการนี้ไม่อยู่ในใบสั่งซื้อ";
  });
  if (Object.keys(fields).length) throw new ApiError(400, Object.values(fields)[0], fields);
}

/** lock เอกสาร + ต้องเป็นร่าง */
async function lockDraft(tx: TxClient, id: string) {
  const rows = await tx.$queryRaw<{ status: string; docNo: string }[]>`SELECT status::text AS status, "docNo" FROM goods_receipts WHERE id = ${id} FOR UPDATE`;
  if (!rows[0]) throw new ApiError(404, "ไม่พบใบนำเข้า");
  if (rows[0].status !== "DRAFT") throw new ApiError(409, "แก้ไขได้เฉพาะใบนำเข้าที่เป็นร่าง");
  return rows[0];
}

/** ตรวจคลัง/สินค้า/สถานที่ */
async function assertRefs(tx: TxClient, d: ReceiptData, keepProductIds: Set<string> = new Set(), currentOrderId?: string | null) {
  if (d.type === "PURCHASE") await assertOrderLines(tx, d, currentOrderId);
  const nodes = (await tx.stockLocation.findMany()) as TreeNode[];
  const wh = nodes.find((n) => n.id === d.warehouseId);
  if (!wh || wh.level !== 0) throw new ApiError(400, "ไม่พบคลัง", { warehouseId: "ไม่พบคลัง" });
  if (!wh.isActive) throw new ApiError(400, "คลังนี้ปิดใช้งานแล้ว", { warehouseId: "คลังนี้ปิดใช้งานแล้ว" });

  const fields: Record<string, string> = {};
  const products = await tx.product.findMany({ where: { id: { in: d.lines.map((l) => l.productId) } } });
  d.lines.forEach((l, i) => {
    const p = products.find((x) => x.id === l.productId);
    if (!p || p.deletedAt) fields[`lines.${i}.productId`] = "ไม่พบสินค้า";
    else if (!p.isStockable) fields[`lines.${i}.productId`] = "สินค้านี้ไม่ได้ตั้งเป็น \"สต๊อกได้\"";
    else if (!p.isActive && !keepProductIds.has(p.id)) fields[`lines.${i}.productId`] = "สินค้านี้ปิดใช้งานแล้ว";
    if (l.locationId) {
      const loc = nodes.find((n) => n.id === l.locationId);
      if (!loc || !isInWarehouse(nodes, l.locationId, d.warehouseId)) fields[`lines.${i}.locationId`] = "สถานที่ไม่อยู่ในคลังที่เลือก";
    }
  });
  if (Object.keys(fields).length) throw new ApiError(400, Object.values(fields)[0], fields);
}

export async function createReceipt(actor: CurrentUser, d: ReceiptData, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    await assertRefs(tx, d);
    const docNo = await allocateDocNumber(tx, DOC_PREFIXES.GOODS_RECEIPT);
    const r = await tx.goodsReceipt.create({
      data: {
        docNo,
        type: d.type,
        purchaseOrderId: d.type === "PURCHASE" ? d.purchaseOrderId : null,
        docDate: dateOnly(d.docDate),
        warehouseId: d.warehouseId,
        lot: d.lot,
        note: d.note,
        createdById: actor.id,
        lines: { create: d.lines.map((l, i) => ({ lineNo: i + 1, productId: l.productId, locationId: l.locationId, orderLineId: d.type === "PURCHASE" ? l.orderLineId : null, note: l.note })) },
      },
    });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_RECEIPT, entityId: r.id, action: "CREATE", after: await snapshot(tx, r.id), ip });
    return r;
  }, STOCK_TX);
}

export async function updateReceipt(actor: CurrentUser, id: string, d: ReceiptData, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    await lockDraft(tx, id);
    const current = await tx.goodsReceipt.findUniqueOrThrow({ where: { id }, include: { lines: { include: { _count: { select: { serials: true } } } } } });
    await assertRefs(tx, d, new Set(current.lines.map((l) => l.productId)), current.purchaseOrderId);
    const before = await snapshot(tx, id);

    const keepIds = new Set(d.lines.map((l) => l.id).filter(Boolean) as string[]);
    for (const l of d.lines) {
      if (!l.id) continue;
      const old = current.lines.find((x) => x.id === l.id);
      if (!old) throw new ApiError(400, "รายการไม่ถูกต้อง กรุณาโหลดหน้าใหม่");
      if (old.productId !== l.productId && old._count.serials) {
        throw new ApiError(400, "เปลี่ยนสินค้าไม่ได้ เพราะสร้าง SN แล้ว (ลบ SN ก่อน หรือเพิ่มรายการใหม่)");
      }
    }
    const removed = current.lines.filter((l) => !keepIds.has(l.id));
    if (removed.length) await tx.goodsReceiptLine.deleteMany({ where: { id: { in: removed.map((l) => l.id) } } });

    await tx.goodsReceipt.update({
      where: { id },
      data: {
        type: d.type,
        purchaseOrderId: d.type === "PURCHASE" ? d.purchaseOrderId : null,
        docDate: dateOnly(d.docDate),
        warehouseId: d.warehouseId,
        lot: d.lot,
        note: d.note,
        updatedById: actor.id,
      },
    });
    for (const [i, l] of d.lines.entries()) {
      const data = { lineNo: i + 1, productId: l.productId, locationId: l.locationId, orderLineId: d.type === "PURCHASE" ? l.orderLineId : null, note: l.note };
      if (l.id) await tx.goodsReceiptLine.update({ where: { id: l.id }, data });
      else await tx.goodsReceiptLine.create({ data: { ...data, receiptId: id } });
    }
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_RECEIPT, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
  }, STOCK_TX);
}

export async function generateSerials(actor: CurrentUser, id: string, lineId: string, count: number, qtyPerSerial: number, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const { docNo } = await lockDraft(tx, id);
    const line = await tx.goodsReceiptLine.findFirst({ where: { id: lineId, receiptId: id }, include: { product: true } });
    if (!line) throw new ApiError(404, "ไม่พบรายการ");
    const agg = await tx.stockSerial.aggregate({ where: { receiptLine: { receiptId: id } }, _max: { seq: true } });
    const plan = planSerials(docNo, agg._max.seq ?? 0, count);
    if (typeof plan === "string") throw new ApiError(400, plan, { count: plan });
    await tx.stockSerial.createMany({
      data: plan.map((p) => ({ barcode: p.barcode, seq: p.seq, productId: line.productId, receiptLineId: line.id, initialQty: qtyPerSerial })),
    });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_RECEIPT,
      entityId: id,
      action: "UPDATE",
      note: `สร้าง SN ${line.product.code}: ${count} SN × ${formatNumber(qtyPerSerial)} (${plan[0].barcode} – ${plan[plan.length - 1].barcode})`,
      force: true,
      ip,
    });
    return { created: plan.length };
  }, STOCK_TX);
}

/** ลบ SN ของรายการ (ไม่ระบุ serialIds = ลบทั้งหมดของรายการ) */
export async function deleteSerials(actor: CurrentUser, id: string, lineId: string, serialIds: string[] | null, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    await lockDraft(tx, id);
    const line = await tx.goodsReceiptLine.findFirst({ where: { id: lineId, receiptId: id }, include: { product: true } });
    if (!line) throw new ApiError(404, "ไม่พบรายการ");
    const where = { receiptLineId: lineId, ...(serialIds ? { id: { in: serialIds } } : {}) };
    const doomed = await tx.stockSerial.findMany({ where, orderBy: { seq: "asc" } });
    if (!doomed.length) return { deleted: 0 };
    await tx.stockSerial.deleteMany({ where: { id: { in: doomed.map((s) => s.id) } } });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_RECEIPT,
      entityId: id,
      action: "UPDATE",
      note: `ลบ SN ${line.product.code}: ${doomed.map((s) => s.barcode).join(", ")}`,
      force: true,
      ip,
    });
    return { deleted: doomed.length };
  }, STOCK_TX);
}

/** สแกน (หรือยกเลิกสแกน) SN ของใบนำเข้าที่เป็นร่าง */
export async function scanReceiptSerial(actor: CurrentUser, id: string, barcode: string, undo: boolean) {
  return prisma.$transaction(async (tx) => {
    await lockDraft(tx, id);
    const s = await tx.stockSerial.findUnique({ where: { barcode }, include: { receiptLine: true, product: true } });
    if (!s || s.receiptLine.receiptId !== id) throw new ApiError(404, `ไม่พบ ${barcode} ในใบนำเข้านี้`);
    const info = { serialId: s.id, barcode: s.barcode, lineId: s.receiptLineId, productCode: s.product.code };
    if (undo) {
      await tx.stockSerial.update({ where: { id: s.id }, data: { scannedAt: null, scannedById: null } });
      return { ...info, scannedAt: null, already: false };
    }
    if (s.scannedAt) return { ...info, scannedAt: s.scannedAt.toISOString(), already: true };
    const u = await tx.stockSerial.update({ where: { id: s.id }, data: { scannedAt: new Date(), scannedById: actor.id } });
    return { ...info, scannedAt: u.scannedAt!.toISOString(), already: false };
  }, STOCK_TX);
}

export async function postReceiptDoc(actor: CurrentUser, id: string, ip: string | null) {
  await postReceiptTx(actor, id, ip);
  kickNotificationWorker();
}

async function postReceiptTx(actor: CurrentUser, id: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const before = await snapshot(tx, id);
    const res = await postReceipt(tx, id, actor.id);
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_RECEIPT,
      entityId: id,
      action: "STATUS_CHANGE",
      before,
      after: await snapshot(tx, id),
      note: `นำเข้าคลัง ${res.serials} SN`,
      ip,
    });
  }, STOCK_TX);
}

export async function cancelReceiptDoc(actor: CurrentUser, id: string, reason: string, ip: string | null) {
  await cancelReceiptTx(actor, id, reason, ip);
  kickNotificationWorker();
}

async function cancelReceiptTx(actor: CurrentUser, id: string, reason: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const before = await snapshot(tx, id);
    const res = await cancelReceipt(tx, id, actor.id, reason);
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_RECEIPT,
      entityId: id,
      action: "CANCEL",
      before,
      after: await snapshot(tx, id),
      note: `${res.wasPosted ? "ยกเลิกและตัดสต๊อกกลับ" : "ยกเลิกร่าง"}: ${reason}`,
      ip,
    });
  }, STOCK_TX);
}

/** ตัวเลือกของฟอร์มใบนำเข้า: คลัง/สถานที่ + สินค้าที่สต๊อกได้ */
export async function getStockFormOptions() {
  const [locations, products] = await Promise.all([
    prisma.stockLocation.findMany(),
    prisma.product.findMany({
      where: { deletedAt: null, isStockable: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, isActive: true, stockUnit: { select: { name: true } } },
    }),
  ]);
  return {
    locations: locations as TreeNode[],
    products: products.map((p) => ({ id: p.id, code: p.code, name: p.name, isActive: p.isActive, unit: p.stockUnit?.name ?? "" })),
  };
}
export type StockFormOptions = Awaited<ReturnType<typeof getStockFormOptions>>;
