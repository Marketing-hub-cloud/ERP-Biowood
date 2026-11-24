import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { allocateDocNumber, DOC_PREFIXES } from "@/lib/doc-number";
import { formatDate, formatNumber, fullName } from "@/lib/format";
import { isApprovedLike, STATUS_LABELS } from "@/lib/approval";
import { calcPurchaseOrder, formatMoney, VAT_MODE_LABELS } from "@/lib/purchase-calc";
import { dateOnly, sumQty, toMilli } from "@/lib/stock-rules";
import { lockRows, poLineReceived, poLineReturned, prLineOrdered, recomputeRequests } from "@/lib/purchase-status";
import type { PurchaseOrderData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import { enqueuePurchaseEvent } from "@/lib/notifications";
import { kickNotificationWorker } from "@/lib/notification-worker";
import type { Prisma } from "@/generated/prisma/client";
import { approvalHistory, recordApprovalAction, runApproval } from "./approval";
import { assertProducts, assertVendor, assertWarehouse, lockDraft, PURCHASE_TX } from "./purchase-common";

export const ENTITY_PO = "PurchaseOrder";

export const orderInclude = {
  vendor: { select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  cancelledBy: { select: { firstName: true, lastName: true } },
  warehouse: true,
  lines: {
    orderBy: { lineNo: "asc" },
    include: { product: { include: { stockUnit: true } }, requestLine: { include: { request: { select: { id: true, docNo: true } } } } },
  },
} satisfies Prisma.PurchaseOrderInclude;
export type OrderFull = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

async function snapshot(tx: TxClient, id: string) {
  const d = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
  return {
    docDate: formatDate(d.docDate),
    deliveryDate: d.deliveryDate ? formatDate(d.deliveryDate) : null,
    vendor: `${d.vendor.code} ${d.vendor.name}`,
    paymentTerms: d.paymentTerms,
    reference: d.reference,
    warehouse: d.warehouse?.name ?? null,
    note: d.note,
    vatMode: VAT_MODE_LABELS[d.vatMode],
    headerDiscount: formatMoney(d.headerDiscount.toString()),
    total: formatMoney(d.total.toString()),
    status: STATUS_LABELS.PO[d.status],
    lines: d.lines.map(
      (l) =>
        `${l.requestLine ? `[${l.requestLine.request.docNo}] ` : ""}${l.product.code} × ${formatNumber(l.quantity.toString())} ${l.product.stockUnit?.name ?? ""} @ ${formatMoney(l.unitPrice.toString())}` +
        `${Number(l.discount) ? ` ลด ${formatMoney(l.discount.toString())}` : ""} = ${formatMoney(l.amount.toString())}`,
    ),
  };
}

/**
 * ตรวจรายการที่อ้างอิง PR: PR ต้องอนุมัติแล้ว, สินค้าตรงกัน, และจำนวนไม่เกินคงค้าง
 * lock แถว PR ก่อนคำนวณ เพื่อกันสร้าง PO จาก PR เดียวกันพร้อมกันจนเกินคงค้าง
 */
async function assertRequestLines(tx: TxClient, d: PurchaseOrderData, orderId: string | null) {
  const refs = d.lines.map((l, i) => ({ ...l, i })).filter((l) => l.requestLineId);
  if (!refs.length) return [] as string[];
  const reqLines = await tx.purchaseRequestLine.findMany({
    where: { id: { in: refs.map((r) => r.requestLineId!) } },
    include: { product: true, request: { select: { id: true, docNo: true } } },
  });
  const requestIds = [...new Set(reqLines.map((l) => l.request.id))];
  const locked = await lockRows(tx, "purchase_requests", requestIds);
  const ordered = await prLineOrdered(tx, reqLines.map((l) => l.id), orderId);
  const fields: Record<string, string> = {};
  for (const r of refs) {
    const rl = reqLines.find((x) => x.id === r.requestLineId);
    const st = locked.find((x) => x.id === rl?.request.id)?.status;
    if (!rl || !st) fields[`lines.${r.i}.productId`] = "ไม่พบรายการใบขอซื้อ";
    else if (st !== "APPROVED" && st !== "PARTIAL" && st !== "COMPLETED") fields[`lines.${r.i}.productId`] = `${rl.request.docNo} ยังไม่อนุมัติหรือถูกยกเลิก`;
    else if (rl.productId !== r.productId) fields[`lines.${r.i}.productId`] = `สินค้าไม่ตรงกับ ${rl.request.docNo}`;
    else {
      const remaining = sumQty([rl.quantity.toString(), -(ordered.get(rl.id) ?? 0)]);
      if (toMilli(r.quantity) > toMilli(remaining)) {
        fields[`lines.${r.i}.quantity`] = `เกินจำนวนคงค้างของ ${rl.request.docNo} (คงค้าง ${formatNumber(remaining)})`;
      }
    }
  }
  if (Object.keys(fields).length) throw new ApiError(409, Object.values(fields)[0], fields);
  return requestIds;
}

function totals(d: PurchaseOrderData) {
  const c = calcPurchaseOrder({ lines: d.lines, headerDiscount: d.headerDiscount, vatMode: d.vatMode });
  if (c.errors.length) throw new ApiError(400, c.errors[0], { headerDiscount: c.errors[0] });
  return c;
}

const header = (d: PurchaseOrderData, c: ReturnType<typeof totals>) => ({
  docDate: dateOnly(d.docDate),
  deliveryDate: d.deliveryDate ? dateOnly(d.deliveryDate) : null,
  vendorId: d.vendorId,
  paymentTerms: d.paymentTerms,
  reference: d.reference,
  warehouseId: d.warehouseId,
  note: d.note,
  vatMode: d.vatMode,
  headerDiscount: d.headerDiscount,
  subtotal: c.subtotal,
  vatAmount: c.vatAmount,
  total: c.total,
});
const lineRows = (d: PurchaseOrderData, c: ReturnType<typeof totals>) =>
  d.lines.map((l, i) => ({
    lineNo: i + 1,
    productId: l.productId,
    requestLineId: l.requestLineId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount,
    amount: c.lineAmounts[i],
    note: l.note,
  }));

export async function createOrder(actor: CurrentUser, d: PurchaseOrderData, ip: string | null) {
  const doc = await prisma.$transaction(async (tx) => {
    await assertVendor(tx, d.vendorId);
    await assertWarehouse(tx, d.warehouseId);
    await assertProducts(tx, d.lines.map((l) => l.productId));
    const c = totals(d);
    const requestIds = await assertRequestLines(tx, d, null);
    const docNo = await allocateDocNumber(tx, DOC_PREFIXES.PURCHASE_ORDER);
    const o = await tx.purchaseOrder.create({ data: { ...header(d, c), docNo, createdById: actor.id, lines: { create: lineRows(d, c) } } });
    await recomputeRequests(tx, requestIds, actor.id);
    await enqueuePurchaseEvent(tx, { kind: "created", docType: "PO", docId: o.id, docNo: o.docNo, status: "DRAFT", actorId: actor.id, actorName: fullName(actor) });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PO, entityId: o.id, action: "CREATE", after: await snapshot(tx, o.id), ip });
    return o;
  }, PURCHASE_TX);
  kickNotificationWorker();
  return doc;
}

export async function updateOrder(actor: CurrentUser, id: string, d: PurchaseOrderData, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    await lockDraft(tx, "purchase_orders", id);
    const current = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    if (d.vendorId !== current.vendorId) await assertVendor(tx, d.vendorId);
    await assertWarehouse(tx, d.warehouseId, current.warehouseId);
    await assertProducts(tx, d.lines.map((l) => l.productId), new Set(current.lines.map((l) => l.productId)));
    const c = totals(d);
    const requestIds = await assertRequestLines(tx, d, id);
    const before = await snapshot(tx, id);
    // ร่างยังไม่เคยอนุมัติ จึงยังไม่มีใบนำเข้า/ใบส่งคืนอ้างอิงรายการ — แทนที่รายการทั้งหมดได้
    await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
    await tx.purchaseOrder.update({ where: { id }, data: { ...header(d, c), updatedById: actor.id, lines: { create: lineRows(d, c) } } });
    const oldRequestIds = current.lines.map((l) => l.requestLine?.request.id).filter(Boolean) as string[];
    await recomputeRequests(tx, [...requestIds, ...oldRequestIds], actor.id);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PO, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
  }, PURCHASE_TX);
}

export async function orderApproval(actor: CurrentUser, id: string, action: "submit" | "approve" | "reject", comment: string | null, ip: string | null) {
  const res = await runApproval(
    actor,
    "PO",
    id,
    action,
    comment,
    {
      snapshot: (tx) => snapshot(tx, id),
      beforeSubmit: async (tx) => {
        const o = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
        if (!o.lines.length) throw new ApiError(400, "กรุณาเพิ่มรายการสินค้าก่อนส่งอนุมัติ");
        await assertVendor(tx, o.vendorId);
      },
    },
    ip,
  );
  kickNotificationWorker();
  return res;
}

export async function cancelOrder(actor: CurrentUser, id: string, reason: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ status: string; docNo: string; approvalRound: number }[]>`
      SELECT status::text AS status, "docNo", "approvalRound" FROM purchase_orders WHERE id = ${id} FOR UPDATE`;
    if (!row) throw new ApiError(404, "ไม่พบใบสั่งซื้อ");
    if (row.status === "CANCELLED") throw new ApiError(409, "เอกสารนี้ถูกยกเลิกแล้ว");
    const receipts = await tx.goodsReceipt.findMany({ where: { purchaseOrderId: id, status: { not: "CANCELLED" } }, select: { docNo: true } });
    const returns = await tx.purchaseReturn.findMany({ where: { orderId: id, status: { not: "CANCELLED" } }, select: { docNo: true } });
    const refs = [...receipts, ...returns].map((r) => r.docNo);
    if (refs.length) throw new ApiError(409, `ยกเลิกไม่ได้ เพราะมีเอกสารอ้างอิงอยู่ (${refs.join(", ")}) กรุณายกเลิกเอกสารเหล่านั้นก่อน`);
    const before = await snapshot(tx, id);
    const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: id }, include: { requestLine: true } });
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED", currentStep: null, cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason, updatedById: actor.id },
    });
    await recomputeRequests(tx, lines.map((l) => l.requestLine?.requestId).filter(Boolean) as string[], actor.id);
    await recordApprovalAction(tx, { docType: "PO", docId: id, round: row.approvalRound, stepNo: null, action: "CANCEL", actorId: actor.id, comment: reason });
    await enqueuePurchaseEvent(tx, { kind: "cancelled", docType: "PO", docId: id, docNo: row.docNo, status: "CANCELLED", actorId: actor.id, actorName: fullName(actor), comment: reason });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PO, entityId: id, action: "CANCEL", before, after: await snapshot(tx, id), note: `ยกเลิก: ${reason}`, ip });
    return row.docNo;
  }, PURCHASE_TX);
  kickNotificationWorker();
}

/** ข้อมูลหน้าเอกสาร: รายการ + นำเข้าแล้ว/ส่งคืนแล้ว + ประวัติ + เอกสารที่อ้างอิง */
export async function getOrderDetail(id: string) {
  const d = await prisma.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
  if (!d) return null;
  const lineIds = d.lines.map((l) => l.id);
  const [received, returned, history, receipts, returns] = await Promise.all([
    poLineReceived(prisma, lineIds),
    poLineReturned(prisma, lineIds),
    approvalHistory("PO", id),
    prisma.goodsReceipt.findMany({ where: { purchaseOrderId: id }, select: { id: true, docNo: true, status: true }, orderBy: { docNo: "asc" } }),
    prisma.purchaseReturn.findMany({ where: { orderId: id }, select: { id: true, docNo: true, status: true }, orderBy: { docNo: "asc" } }),
  ]);
  return { doc: d, received, returned, history, receipts, returns };
}

/** รายการ PO ที่ยังรับไม่ครบ (ใช้สร้างใบนำเข้า) */
export async function openOrderLines(orderId: string) {
  const o = await prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } }, vendor: true },
  });
  if (!o || !isApprovedLike(o.status)) return null;
  const received = await poLineReceived(prisma, o.lines.map((l) => l.id));
  return {
    order: { id: o.id, docNo: o.docNo, warehouseId: o.warehouseId, vendorName: o.vendor.name, status: o.status },
    lines: o.lines.map((l) => ({
      orderLineId: l.id,
      productId: l.productId,
      productCode: l.product.code,
      productName: l.product.name,
      unit: l.product.stockUnit?.name ?? "",
      isStockable: l.product.isStockable,
      quantity: Number(l.quantity),
      received: received.get(l.id) ?? 0,
      remaining: sumQty([l.quantity.toString(), -(received.get(l.id) ?? 0)]),
    })),
  };
}
export type OpenOrder = NonNullable<Awaited<ReturnType<typeof openOrderLines>>>;

/** รายการที่ส่งคืนได้ของ PO = นำเข้าแล้ว − ใบส่งคืนอื่นที่ยังไม่ยกเลิก */
export async function returnableLines(orderId: string, excludeReturnId?: string | null) {
  const o = await prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } }, vendor: true },
  });
  if (!o) return null;
  const ids = o.lines.map((l) => l.id);
  const [received, returned] = await Promise.all([poLineReceived(prisma, ids), poLineReturned(prisma, ids, excludeReturnId)]);
  return {
    order: { id: o.id, docNo: o.docNo, status: o.status, vendor: { id: o.vendor.id, code: o.vendor.code, name: o.vendor.name } },
    lines: o.lines.map((l) => ({
      orderLineId: l.id,
      productId: l.productId,
      productCode: l.product.code,
      productName: l.product.name,
      unit: l.product.stockUnit?.name ?? "",
      received: received.get(l.id) ?? 0,
      returned: returned.get(l.id) ?? 0,
      returnable: sumQty([received.get(l.id) ?? 0, -(returned.get(l.id) ?? 0)]),
    })),
  };
}
export type ReturnableOrder = NonNullable<Awaited<ReturnType<typeof returnableLines>>>;

/** ใบสั่งซื้อที่นำเข้าได้ (อนุมัติแล้ว ยังรับไม่ครบ) */
export async function receivableOrders(): Promise<{ id: string; docNo: string; vendor: string; warehouseId: string | null }[]> {
  const docs = await prisma.purchaseOrder.findMany({
    where: { status: { in: ["APPROVED", "PARTIAL"] } },
    include: { vendor: { select: { name: true } } },
    orderBy: { docNo: "desc" },
    take: 200,
  });
  return docs.map((d) => ({ id: d.id, docNo: d.docNo, vendor: d.vendor.name, warehouseId: d.warehouseId }));
}
