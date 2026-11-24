// จำนวนสะสมของเอกสารจัดซื้อ (คำนวณจากเอกสารที่อ้างอิง ไม่เก็บเป็นตัวเลข) + คำนวณสถานะ PARTIAL/COMPLETED ใหม่
// ทุกฟังก์ชันรับ tx — เรียกใน transaction เดียวกับการบันทึกเอกสารที่เกี่ยวข้อง
import { fulfillmentStatus, type PurchaseStatus } from "./approval";
import { enqueuePurchaseEvent } from "./notifications";
import { toMilli } from "./stock-rules";
import type { DbClient, TxClient } from "./db";

type Db = TxClient | DbClient;
type QtyRow = { id: string; qty: string };
const toMap = (rows: QtyRow[]) => new Map(rows.map((r) => [r.id, Number(r.qty)]));
const NONE = "__none__";

/** สั่งซื้อแล้วต่อรายการ PR = รายการ PO ที่ยังไม่ยกเลิก (รวมร่าง) — excludeOrderId = ไม่นับ PO ใบนี้ */
export async function prLineOrdered(db: Db, requestLineIds: string[], excludeOrderId?: string | null): Promise<Map<string, number>> {
  if (!requestLineIds.length) return new Map();
  return toMap(
    await db.$queryRaw<QtyRow[]>`
      SELECT l."requestLineId" AS id, SUM(l.quantity)::text AS qty
      FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l."orderId"
      WHERE l."requestLineId" = ANY(${requestLineIds}) AND o.status <> 'CANCELLED' AND o.id <> ${excludeOrderId ?? NONE}
      GROUP BY l."requestLineId"`,
  );
}

/** นำเข้าแล้วต่อรายการ PO = จำนวนของ SN ในใบนำเข้าที่ "นำเข้าแล้ว" */
export async function poLineReceived(db: Db, orderLineIds: string[]): Promise<Map<string, number>> {
  if (!orderLineIds.length) return new Map();
  return toMap(
    await db.$queryRaw<QtyRow[]>`
      SELECT gl."orderLineId" AS id, SUM(s."initialQty")::text AS qty
      FROM stock_serials s
      JOIN goods_receipt_lines gl ON gl.id = s."receiptLineId"
      JOIN goods_receipts g ON g.id = gl."receiptId"
      WHERE gl."orderLineId" = ANY(${orderLineIds}) AND g.status = 'POSTED'
      GROUP BY gl."orderLineId"`,
  );
}

/** ส่งคืนแล้ว (ตามใบส่งคืนที่ยังไม่ยกเลิก) ต่อรายการ PO — excludeReturnId = ไม่นับใบส่งคืนใบนี้ */
export async function poLineReturned(db: Db, orderLineIds: string[], excludeReturnId?: string | null): Promise<Map<string, number>> {
  if (!orderLineIds.length) return new Map();
  return toMap(
    await db.$queryRaw<QtyRow[]>`
      SELECT l."orderLineId" AS id, SUM(l.quantity)::text AS qty
      FROM purchase_return_lines l JOIN purchase_returns r ON r.id = l."returnId"
      WHERE l."orderLineId" = ANY(${orderLineIds}) AND r.status <> 'CANCELLED' AND r.id <> ${excludeReturnId ?? NONE}
      GROUP BY l."orderLineId"`,
  );
}

/** นำออก (ส่งคืน) แล้วต่อรายการใบส่งคืน = ใบนำออกที่ "นำออกแล้ว" */
export async function rtLineIssued(db: Db, returnLineIds: string[]): Promise<Map<string, number>> {
  if (!returnLineIds.length) return new Map();
  return toMap(
    await db.$queryRaw<QtyRow[]>`
      SELECT l."returnLineId" AS id, SUM(l.quantity)::text AS qty
      FROM goods_issue_lines l JOIN goods_issues g ON g.id = l."issueId"
      WHERE l."returnLineId" = ANY(${returnLineIds}) AND g.status = 'POSTED'
      GROUP BY l."returnLineId"`,
  );
}

const APPROVED_LIKE: PurchaseStatus[] = ["APPROVED", "PARTIAL", "COMPLETED"];

/** คำนวณสถานะ PR ใหม่ (สั่งซื้อแล้วบางส่วน / สั่งซื้อแล้ว) */
export async function recomputeRequests(tx: TxClient, requestIds: string[], actorId: string | null = null) {
  const ids = [...new Set(requestIds)];
  if (!ids.length) return;
  const docs = await tx.purchaseRequest.findMany({ where: { id: { in: ids }, status: { in: APPROVED_LIKE } }, include: { lines: true } });
  for (const d of docs) {
    const done = await prLineOrdered(tx, d.lines.map((l) => l.id));
    const status = fulfillmentStatus(d.lines.map((l) => ({ qtyMilli: toMilli(l.quantity.toString()), doneMilli: toMilli(done.get(l.id) ?? 0) })));
    if (status !== d.status) {
      await tx.purchaseRequest.update({ where: { id: d.id }, data: { status } });
      await enqueuePurchaseEvent(tx, { kind: "status", docType: "PR", docId: d.id, docNo: d.docNo, status, actorId });
    }
  }
}

/** คำนวณสถานะ PO ใหม่ (นำเข้าแล้วบางส่วน / นำเข้าแล้ว) */
export async function recomputeOrders(tx: TxClient, orderIds: string[], actorId: string | null = null) {
  const ids = [...new Set(orderIds)];
  if (!ids.length) return;
  const docs = await tx.purchaseOrder.findMany({ where: { id: { in: ids }, status: { in: APPROVED_LIKE } }, include: { lines: true } });
  for (const d of docs) {
    const done = await poLineReceived(tx, d.lines.map((l) => l.id));
    const status = fulfillmentStatus(d.lines.map((l) => ({ qtyMilli: toMilli(l.quantity.toString()), doneMilli: toMilli(done.get(l.id) ?? 0) })));
    if (status !== d.status) {
      await tx.purchaseOrder.update({ where: { id: d.id }, data: { status } });
      await enqueuePurchaseEvent(tx, { kind: "status", docType: "PO", docId: d.id, docNo: d.docNo, status, actorId });
    }
  }
}

/** คำนวณสถานะใบส่งคืนใหม่ (ส่งคืนแล้วบางส่วน / ส่งคืนแล้ว) */
export async function recomputeReturns(tx: TxClient, returnIds: string[], actorId: string | null = null) {
  const ids = [...new Set(returnIds)];
  if (!ids.length) return;
  const docs = await tx.purchaseReturn.findMany({ where: { id: { in: ids }, status: { in: APPROVED_LIKE } }, include: { lines: true } });
  for (const d of docs) {
    const done = await rtLineIssued(tx, d.lines.map((l) => l.id));
    const status = fulfillmentStatus(d.lines.map((l) => ({ qtyMilli: toMilli(l.quantity.toString()), doneMilli: toMilli(done.get(l.id) ?? 0) })));
    if (status !== d.status) {
      await tx.purchaseReturn.update({ where: { id: d.id }, data: { status } });
      await enqueuePurchaseEvent(tx, { kind: "status", docType: "RT", docId: d.id, docNo: d.docNo, status, actorId });
    }
  }
}

/** lock แถวเอกสาร (เรียง id กัน deadlock) */
export async function lockRows(tx: TxClient, table: "purchase_requests" | "purchase_orders" | "purchase_returns", ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return [];
  if (table === "purchase_requests") return tx.$queryRaw<{ id: string; status: PurchaseStatus }[]>`SELECT id, status::text AS status FROM purchase_requests WHERE id = ANY(${sorted}) ORDER BY id FOR UPDATE`;
  if (table === "purchase_orders") return tx.$queryRaw<{ id: string; status: PurchaseStatus }[]>`SELECT id, status::text AS status FROM purchase_orders WHERE id = ANY(${sorted}) ORDER BY id FOR UPDATE`;
  return tx.$queryRaw<{ id: string; status: PurchaseStatus }[]>`SELECT id, status::text AS status FROM purchase_returns WHERE id = ANY(${sorted}) ORDER BY id FOR UPDATE`;
}
