// Stock ledger: เขียน movement ตอนนำเข้า/นำออก/ยกเลิก — ทุกฟังก์ชันต้องเรียกภายใน transaction
// ยอดคงเหลือคำนวณจาก SUM(stock_movements.quantity) เท่านั้น
// กันยอดติดลบเมื่อกดพร้อมกัน: lock แถวเอกสาร + แถว SN (SELECT ... FOR UPDATE) ก่อนคำนวณยอด
import { ApiError } from "./errors";
import { ancestry, type TreeNode } from "./tree";
import { checkIssueQuantities, fromMilli, sumQty, toMilli } from "./stock-rules";
import { lockRows, poLineReceived, recomputeOrders, recomputeReturns, rtLineIssued } from "./purchase-status";
import type { TxClient } from "./db";

/**
 * ตัวเลือก transaction ของเอกสารคลัง: รอ lock ได้นานกว่าค่าเริ่มต้น (5 วินาที)
 * เพื่อให้ request ที่กดพร้อมกันรอคิวแล้วได้ผลตรวจยอดที่ถูกต้อง แทนที่จะ timeout
 */
export const STOCK_TX = { maxWait: 10_000, timeout: 30_000 } as const;

type Status = "DRAFT" | "POSTED" | "CANCELLED";
const STATUS_MSG: Record<Status, string> = { DRAFT: "ร่าง", POSTED: "บันทึกเข้าคลังแล้ว", CANCELLED: "ถูกยกเลิกแล้ว" };

async function lockDoc(tx: TxClient, table: "goods_receipts" | "goods_issues", id: string): Promise<Status> {
  const rows =
    table === "goods_receipts"
      ? await tx.$queryRaw<{ status: Status }[]>`SELECT status::text AS status FROM goods_receipts WHERE id = ${id} FOR UPDATE`
      : await tx.$queryRaw<{ status: Status }[]>`SELECT status::text AS status FROM goods_issues WHERE id = ${id} FOR UPDATE`;
  if (!rows[0]) throw new ApiError(404, "ไม่พบเอกสาร");
  return rows[0].status;
}

function assertDraft(status: Status) {
  if (status !== "DRAFT") throw new ApiError(409, `เอกสารนี้${STATUS_MSG[status]}`);
}

/** lock แถว SN (เรียงตาม id เพื่อกัน deadlock) */
export async function lockSerials(tx: TxClient, ids: string[]) {
  if (!ids.length) return;
  await tx.$queryRaw`SELECT id FROM stock_serials WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
}

/** คงเหลือต่อ SN (ไม่มี movement = ไม่อยู่ใน map) */
export async function serialBalances(tx: TxClient, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await tx.$queryRaw<{ serialId: string; qty: string }[]>`
    SELECT "serialId", SUM(quantity)::text AS qty FROM stock_movements WHERE "serialId" = ANY(${ids}) GROUP BY "serialId"`;
  return new Map(rows.map((r) => [r.serialId, Number(r.qty)]));
}

export function isInWarehouse(nodes: TreeNode[], locationId: string, warehouseId: string) {
  return ancestry(nodes, locationId)[0]?.id === warehouseId;
}

// ───────────── นำเข้า ─────────────

export async function postReceipt(tx: TxClient, receiptId: string, actorId: string) {
  assertDraft(await lockDoc(tx, "goods_receipts", receiptId));
  const r = await tx.goodsReceipt.findUniqueOrThrow({
    where: { id: receiptId },
    include: {
      warehouse: true,
      lines: { orderBy: { lineNo: "asc" }, include: { product: true, serials: { orderBy: { seq: "asc" } } } },
    },
  });
  if (r.type === "PURCHASE") await assertWithinOrder(tx, r.purchaseOrderId, r.lines);
  if (!r.warehouse.isActive || r.warehouse.level !== 0) throw new ApiError(400, "คลังนี้ปิดใช้งานแล้ว", { warehouseId: "คลังนี้ปิดใช้งานแล้ว" });
  if (!r.lines.length) throw new ApiError(400, "กรุณาเพิ่มรายการสินค้า");

  const nodes = (await tx.stockLocation.findMany()) as TreeNode[];
  const fields: Record<string, string> = {};
  r.lines.forEach((l, i) => {
    const p = `lines.${i}`;
    if (l.product.deletedAt || !l.product.isStockable) fields[`${p}.productId`] = `${l.product.code} ไม่ใช่สินค้าที่สต๊อกได้`;
    if (!l.locationId) fields[`${p}.locationId`] = "กรุณาเลือกสถานที่จัดเก็บ";
    else {
      const loc = nodes.find((n) => n.id === l.locationId);
      if (!loc || !isInWarehouse(nodes, l.locationId, r.warehouseId)) fields[`${p}.locationId`] = "สถานที่ไม่อยู่ในคลังที่เลือก";
      else if (!loc.isActive) fields[`${p}.locationId`] = "สถานที่นี้ปิดใช้งานแล้ว";
    }
    if (!l.serials.length) fields[`${p}.serials`] = "ยังไม่ได้สร้าง Barcode/SN";
    else {
      const pending = l.serials.filter((s) => !s.scannedAt).length;
      if (pending) fields[`${p}.serials`] = `ยังไม่ได้สแกนอีก ${pending} SN`;
    }
  });
  if (Object.keys(fields).length) throw new ApiError(400, Object.values(fields)[0], fields);

  const now = new Date();
  for (const l of r.lines) {
    await tx.stockSerial.updateMany({
      where: { receiptLineId: l.id },
      data: { warehouseId: r.warehouseId, locationId: l.locationId, lot: r.lot },
    });
    await tx.stockMovement.createMany({
      data: l.serials.map((s) => ({
        type: "RECEIPT" as const,
        productId: l.productId,
        warehouseId: r.warehouseId,
        locationId: l.locationId,
        serialId: s.id,
        lot: r.lot,
        quantity: s.initialQty,
        refType: "GR",
        refId: r.id,
        refLineId: l.id,
        refDocNo: r.docNo,
        occurredAt: now,
        createdById: actorId,
      })),
    });
  }
  await tx.goodsReceipt.update({ where: { id: r.id }, data: { status: "POSTED", postedAt: now, postedById: actorId, updatedById: actorId } });
  if (r.purchaseOrderId) await recomputeOrders(tx, [r.purchaseOrderId]);
  return { serials: r.lines.reduce((n, l) => n + l.serials.length, 0) };
}

export async function cancelReceipt(tx: TxClient, receiptId: string, actorId: string, reason: string) {
  const status = await lockDoc(tx, "goods_receipts", receiptId);
  if (status === "CANCELLED") throw new ApiError(409, "เอกสารนี้ถูกยกเลิกแล้ว");
  const now = new Date();
  if (status === "POSTED") {
    const r = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { lines: { include: { serials: true } } } });
    const serials = r.lines.flatMap((l) => l.serials.map((s) => ({ ...s, line: l })));
    await lockSerials(tx, serials.map((s) => s.id));
    const bal = await serialBalances(tx, serials.map((s) => s.id));
    const used = serials.filter((s) => toMilli(bal.get(s.id) ?? 0) !== toMilli(s.initialQty.toString()));
    if (used.length) {
      throw new ApiError(
        409,
        `ยกเลิกไม่ได้ เพราะมี SN ถูกนำออกไปแล้ว ${used.length} SN (${used.slice(0, 3).map((s) => s.barcode).join(", ")}${used.length > 3 ? ", ..." : ""}) กรุณายกเลิกใบนำออกที่เกี่ยวข้องก่อน`,
      );
    }
    await tx.stockMovement.createMany({
      data: serials.map((s) => ({
        type: "RECEIPT_REVERSAL" as const,
        productId: s.productId,
        warehouseId: s.warehouseId!,
        locationId: s.locationId,
        serialId: s.id,
        lot: s.lot,
        quantity: fromMilli(-toMilli(s.initialQty.toString())),
        refType: "GR",
        refId: r.id,
        refLineId: s.line.id,
        refDocNo: r.docNo,
        occurredAt: now,
        createdById: actorId,
      })),
    });
  }
  const cancelled = await tx.goodsReceipt.update({
    where: { id: receiptId },
    data: { status: "CANCELLED", cancelledAt: now, cancelledById: actorId, cancelReason: reason, updatedById: actorId },
  });
  if (cancelled.purchaseOrderId) await recomputeOrders(tx, [cancelled.purchaseOrderId]);
  return { wasPosted: status === "POSTED" };
}

// ───────────── นำออก ─────────────

export async function postIssue(tx: TxClient, issueId: string, actorId: string) {
  assertDraft(await lockDoc(tx, "goods_issues", issueId));
  const doc = await tx.goodsIssue.findUniqueOrThrow({
    where: { id: issueId },
    include: { lines: { orderBy: { lineNo: "asc" }, include: { serial: { include: { receiptLine: { include: { receipt: true } } } } } } },
  });
  if (doc.type === "RETURN") await assertWithinReturn(tx, doc.purchaseReturnId, doc.lines);
  if (!doc.lines.length) throw new ApiError(400, "กรุณาสแกน SN ที่จะนำออก");

  const ids = doc.lines.map((l) => l.serialId);
  await lockSerials(tx, ids);
  const bal = await serialBalances(tx, ids);
  const errs = checkIssueQuantities(doc.lines.map((l) => ({ serialId: l.serialId, quantity: l.quantity.toString() })), bal);
  const fields: Record<string, string> = {};
  doc.lines.forEach((l, i) => {
    if (l.serial.receiptLine.receipt.status !== "POSTED" || !l.serial.warehouseId) fields[`lines.${i}.quantity`] = `${l.serial.barcode} ยังไม่ได้นำเข้าคลัง`;
    else if (errs[l.serialId]) fields[`lines.${i}.quantity`] = `${l.serial.barcode}: ${errs[l.serialId]}`;
  });
  if (Object.keys(fields).length) throw new ApiError(409, Object.values(fields)[0], fields);

  const now = new Date();
  await tx.stockMovement.createMany({
    data: doc.lines.map((l) => ({
      type: "ISSUE" as const,
      productId: l.productId,
      warehouseId: l.serial.warehouseId!,
      locationId: l.serial.locationId,
      serialId: l.serialId,
      lot: l.serial.lot,
      quantity: fromMilli(-toMilli(l.quantity.toString())),
      refType: "GI",
      refId: doc.id,
      refLineId: l.id,
      refDocNo: doc.docNo,
      occurredAt: now,
      createdById: actorId,
    })),
  });
  await tx.goodsIssue.update({ where: { id: doc.id }, data: { status: "POSTED", postedAt: now, postedById: actorId, updatedById: actorId } });
  if (doc.purchaseReturnId) await recomputeReturns(tx, [doc.purchaseReturnId]);
}

export async function cancelIssue(tx: TxClient, issueId: string, actorId: string, reason: string) {
  const status = await lockDoc(tx, "goods_issues", issueId);
  if (status === "CANCELLED") throw new ApiError(409, "เอกสารนี้ถูกยกเลิกแล้ว");
  const now = new Date();
  if (status === "POSTED") {
    const doc = await tx.goodsIssue.findUniqueOrThrow({ where: { id: issueId }, include: { lines: { include: { serial: true } } } });
    await lockSerials(tx, doc.lines.map((l) => l.serialId));
    await tx.stockMovement.createMany({
      data: doc.lines.map((l) => ({
        type: "ISSUE_REVERSAL" as const,
        productId: l.productId,
        warehouseId: l.serial.warehouseId!,
        locationId: l.serial.locationId,
        serialId: l.serialId,
        lot: l.serial.lot,
        quantity: l.quantity,
        refType: "GI",
        refId: doc.id,
        refLineId: l.id,
        refDocNo: doc.docNo,
        occurredAt: now,
        createdById: actorId,
      })),
    });
  }
  const cancelled = await tx.goodsIssue.update({
    where: { id: issueId },
    data: { status: "CANCELLED", cancelledAt: now, cancelledById: actorId, cancelReason: reason, updatedById: actorId },
  });
  if (cancelled.purchaseReturnId) await recomputeReturns(tx, [cancelled.purchaseReturnId]);
  return { wasPosted: status === "POSTED" };
}

// ───────────── อ้างอิงเอกสารจัดซื้อ ─────────────

const APPROVED_LIKE = ["APPROVED", "PARTIAL", "COMPLETED"];

/** นำเข้าจาก PO: lock PO แล้วตรวจว่ารับรวมไม่เกินจำนวนสั่งของแต่ละรายการ */
async function assertWithinOrder(
  tx: TxClient,
  orderId: string | null,
  lines: { orderLineId: string | null; productId: string; serials: { initialQty: { toString(): string } }[] }[],
) {
  if (!orderId) throw new ApiError(400, "กรุณาเลือกใบสั่งซื้อ");
  const [po] = await lockRows(tx, "purchase_orders", [orderId]);
  if (!po || !APPROVED_LIKE.includes(po.status)) throw new ApiError(409, "ใบสั่งซื้อนี้ยังไม่อนุมัติหรือถูกยกเลิกแล้ว");
  const orderLines = await tx.purchaseOrderLine.findMany({ where: { orderId }, include: { product: true } });
  const received = await poLineReceived(tx, orderLines.map((l) => l.id));
  const fields: Record<string, string> = {};
  const want = new Map<string, number>();
  lines.forEach((l, i) => {
    const ol = orderLines.find((x) => x.id === l.orderLineId);
    if (!ol || ol.productId !== l.productId) fields[`lines.${i}.productId`] = "รายการนี้ไม่อยู่ในใบสั่งซื้อ";
    else want.set(ol.id, sumQty([want.get(ol.id) ?? 0, ...l.serials.map((s) => s.initialQty.toString())]));
  });
  for (const [olId, qty] of want) {
    const ol = orderLines.find((x) => x.id === olId)!;
    const remaining = sumQty([ol.quantity.toString(), -(received.get(olId) ?? 0)]);
    if (toMilli(qty) > toMilli(remaining)) {
      const i = lines.findIndex((l) => l.orderLineId === olId);
      fields[`lines.${i}.serials`] = `${ol.product.code}: เกินจำนวนคงค้างของใบสั่งซื้อ (คงค้าง ${remaining.toLocaleString("en-US")})`;
    }
  }
  if (Object.keys(fields).length) throw new ApiError(409, Object.values(fields)[0], fields);
}

/** นำออกประเภทส่งคืน: lock ใบส่งคืน แล้วตรวจว่าคืนรวมไม่เกินจำนวนในใบส่งคืนของแต่ละรายการ */
async function assertWithinReturn(
  tx: TxClient,
  returnId: string | null,
  lines: { returnLineId: string | null; productId: string; quantity: { toString(): string } }[],
) {
  if (!returnId) throw new ApiError(400, "กรุณาเลือกใบส่งคืน");
  const [rt] = await lockRows(tx, "purchase_returns", [returnId]);
  if (!rt || !APPROVED_LIKE.includes(rt.status)) throw new ApiError(409, "ใบส่งคืนนี้ยังไม่อนุมัติหรือถูกยกเลิกแล้ว");
  const rtLines = await tx.purchaseReturnLine.findMany({ where: { returnId }, include: { product: true } });
  const issued = await rtLineIssued(tx, rtLines.map((l) => l.id));
  const fields: Record<string, string> = {};
  const want = new Map<string, number>();
  lines.forEach((l, i) => {
    const rl = rtLines.find((x) => x.id === l.returnLineId);
    if (!rl || rl.productId !== l.productId) fields[`lines.${i}.quantity`] = "สินค้านี้ไม่อยู่ในใบส่งคืน";
    else want.set(rl.id, sumQty([want.get(rl.id) ?? 0, l.quantity.toString()]));
  });
  for (const [rlId, qty] of want) {
    const rl = rtLines.find((x) => x.id === rlId)!;
    const remaining = sumQty([rl.quantity.toString(), -(issued.get(rlId) ?? 0)]);
    if (toMilli(qty) > toMilli(remaining)) {
      const i = lines.findIndex((l) => l.returnLineId === rlId);
      fields[`lines.${i}.quantity`] = `${rl.product.code}: เกินจำนวนที่ต้องส่งคืน (คงค้าง ${remaining.toLocaleString("en-US")})`;
    }
  }
  if (Object.keys(fields).length) throw new ApiError(409, Object.values(fields)[0], fields);
}
