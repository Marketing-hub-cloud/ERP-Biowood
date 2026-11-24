import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { allocateDocNumber, DOC_PREFIXES } from "@/lib/doc-number";
import { formatDate, formatNumber, fullName } from "@/lib/format";
import { isApprovedLike, STATUS_LABELS } from "@/lib/approval";
import { dateOnly, sumQty, toMilli } from "@/lib/stock-rules";
import { lockRows, poLineReceived, poLineReturned, rtLineIssued } from "@/lib/purchase-status";
import type { PurchaseReturnData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import { enqueuePurchaseEvent } from "@/lib/notifications";
import { kickNotificationWorker } from "@/lib/notification-worker";
import type { Prisma } from "@/generated/prisma/client";
import { approvalHistory, recordApprovalAction, runApproval } from "./approval";
import { lockDraft, PURCHASE_TX } from "./purchase-common";

export const ENTITY_RT = "PurchaseReturn";

export const returnInclude = {
  order: { select: { id: true, docNo: true, status: true } },
  vendor: { select: { id: true, code: true, name: true } },
  reason: true,
  createdBy: { select: { firstName: true, lastName: true } },
  cancelledBy: { select: { firstName: true, lastName: true } },
  lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } },
} satisfies Prisma.PurchaseReturnInclude;
export type ReturnFull = Prisma.PurchaseReturnGetPayload<{ include: typeof returnInclude }>;

async function snapshot(tx: TxClient, id: string) {
  const d = await tx.purchaseReturn.findUniqueOrThrow({ where: { id }, include: returnInclude });
  return {
    docDate: formatDate(d.docDate),
    order: d.order.docNo,
    vendor: `${d.vendor.code} ${d.vendor.name}`,
    reason: d.reason.label,
    note: d.note,
    status: STATUS_LABELS.RT[d.status],
    lines: d.lines.map((l) => `${l.product.code} × ${formatNumber(l.quantity.toString())} ${l.product.stockUnit?.name ?? ""}`.trim()),
  };
}

/** PO ต้องอนุมัติแล้ว, เหตุผลต้องมีอยู่, และจำนวนคืนไม่เกิน นำเข้าแล้ว − ใบส่งคืนอื่น (lock PO กันคืนเกินพร้อมกัน) */
async function assertRefs(tx: TxClient, d: PurchaseReturnData, returnId: string | null, currentReasonId?: string) {
  const [po] = await lockRows(tx, "purchase_orders", [d.orderId]);
  if (!po || !isApprovedLike(po.status)) throw new ApiError(400, "ใบสั่งซื้อนี้ยังไม่อนุมัติหรือถูกยกเลิก", { orderId: "ใบสั่งซื้อไม่ถูกต้อง" });
  if (d.reasonId !== currentReasonId) {
    const reason = await tx.lookupOption.findFirst({ where: { id: d.reasonId, kind: "RETURN_REASON", isActive: true } });
    if (!reason) throw new ApiError(400, "ไม่พบเหตุผลการคืน", { reasonId: "ไม่พบเหตุผลการคืน" });
  }
  const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: d.orderId }, include: { lines: { include: { product: true } } } });
  const ids = order.lines.map((l) => l.id);
  const received = await poLineReceived(tx, ids);
  const returned = await poLineReturned(tx, ids, returnId);
  const fields: Record<string, string> = {};
  d.lines.forEach((l, i) => {
    const ol = order.lines.find((x) => x.id === l.orderLineId);
    if (!ol) {
      fields[`lines.${i}.quantity`] = "รายการไม่อยู่ในใบสั่งซื้อ";
      return;
    }
    const returnable = sumQty([received.get(ol.id) ?? 0, -(returned.get(ol.id) ?? 0)]);
    if (toMilli(l.quantity) > toMilli(returnable)) fields[`lines.${i}.quantity`] = `${ol.product.code}: เกินจำนวนที่คืนได้ (คืนได้ ${formatNumber(returnable)})`;
  });
  if (Object.keys(fields).length) throw new ApiError(409, Object.values(fields)[0], fields);
  return order;
}

const lineRows = (d: PurchaseReturnData, order: { lines: { id: string; productId: string }[] }) =>
  d.lines.map((l, i) => ({ lineNo: i + 1, orderLineId: l.orderLineId, productId: order.lines.find((x) => x.id === l.orderLineId)!.productId, quantity: l.quantity, note: l.note }));

export async function createReturn(actor: CurrentUser, d: PurchaseReturnData, ip: string | null) {
  const doc = await prisma.$transaction(async (tx) => {
    const order = await assertRefs(tx, d, null);
    const docNo = await allocateDocNumber(tx, DOC_PREFIXES.PURCHASE_RETURN);
    const r = await tx.purchaseReturn.create({
      data: {
        docNo,
        docDate: dateOnly(d.docDate),
        orderId: d.orderId,
        vendorId: order.vendorId,
        reasonId: d.reasonId,
        note: d.note,
        createdById: actor.id,
        lines: { create: lineRows(d, order) },
      },
    });
    await enqueuePurchaseEvent(tx, { kind: "created", docType: "RT", docId: r.id, docNo: r.docNo, status: "DRAFT", actorId: actor.id, actorName: fullName(actor) });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_RT, entityId: r.id, action: "CREATE", after: await snapshot(tx, r.id), ip });
    return r;
  }, PURCHASE_TX);
  kickNotificationWorker();
  return doc;
}

export async function updateReturn(actor: CurrentUser, id: string, d: PurchaseReturnData, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    await lockDraft(tx, "purchase_returns", id);
    const current = await tx.purchaseReturn.findUniqueOrThrow({ where: { id } });
    if (current.orderId !== d.orderId) throw new ApiError(400, "เปลี่ยนใบสั่งซื้อของใบส่งคืนไม่ได้ (สร้างใบใหม่แทน)");
    const order = await assertRefs(tx, d, id, current.reasonId);
    const before = await snapshot(tx, id);
    await tx.purchaseReturnLine.deleteMany({ where: { returnId: id } });
    await tx.purchaseReturn.update({
      where: { id },
      data: { docDate: dateOnly(d.docDate), reasonId: d.reasonId, note: d.note, updatedById: actor.id, lines: { create: lineRows(d, order) } },
    });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_RT, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
  }, PURCHASE_TX);
}

export async function returnApproval(actor: CurrentUser, id: string, action: "submit" | "approve" | "reject", comment: string | null, ip: string | null) {
  const res = await runApproval(
    actor,
    "RT",
    id,
    action,
    comment,
    {
      snapshot: (tx) => snapshot(tx, id),
      beforeSubmit: async (tx) => {
        const n = await tx.purchaseReturnLine.count({ where: { returnId: id } });
        if (!n) throw new ApiError(400, "กรุณาระบุรายการที่คืนก่อนส่งอนุมัติ");
      },
    },
    ip,
  );
  kickNotificationWorker();
  return res;
}

export async function cancelReturn(actor: CurrentUser, id: string, reason: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ status: string; docNo: string; approvalRound: number }[]>`
      SELECT status::text AS status, "docNo", "approvalRound" FROM purchase_returns WHERE id = ${id} FOR UPDATE`;
    if (!row) throw new ApiError(404, "ไม่พบใบส่งคืน");
    if (row.status === "CANCELLED") throw new ApiError(409, "เอกสารนี้ถูกยกเลิกแล้ว");
    const issues = await tx.goodsIssue.findMany({ where: { purchaseReturnId: id, status: { not: "CANCELLED" } }, select: { docNo: true } });
    if (issues.length) throw new ApiError(409, `ยกเลิกไม่ได้ เพราะมีใบนำออกอ้างอิงอยู่ (${issues.map((i) => i.docNo).join(", ")}) กรุณายกเลิกใบนำออกก่อน`);
    const before = await snapshot(tx, id);
    await tx.purchaseReturn.update({
      where: { id },
      data: { status: "CANCELLED", currentStep: null, cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason, updatedById: actor.id },
    });
    await recordApprovalAction(tx, { docType: "RT", docId: id, round: row.approvalRound, stepNo: null, action: "CANCEL", actorId: actor.id, comment: reason });
    await enqueuePurchaseEvent(tx, { kind: "cancelled", docType: "RT", docId: id, docNo: row.docNo, status: "CANCELLED", actorId: actor.id, actorName: fullName(actor), comment: reason });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_RT, entityId: id, action: "CANCEL", before, after: await snapshot(tx, id), note: `ยกเลิก: ${reason}`, ip });
    return row.docNo;
  }, PURCHASE_TX);
  kickNotificationWorker();
}

export async function getReturnDetail(id: string) {
  const d = await prisma.purchaseReturn.findUnique({ where: { id }, include: returnInclude });
  if (!d) return null;
  const [issued, history, issues] = await Promise.all([
    rtLineIssued(prisma, d.lines.map((l) => l.id)),
    approvalHistory("RT", id),
    prisma.goodsIssue.findMany({ where: { purchaseReturnId: id }, select: { id: true, docNo: true, status: true }, orderBy: { docNo: "asc" } }),
  ]);
  return { doc: d, issued, history, issues };
}

/** รายการที่ยังต้องส่งคืน (ใช้สร้างใบนำออกประเภทส่งคืน) */
export async function openReturnLines(returnId: string) {
  const r = await prisma.purchaseReturn.findUnique({ where: { id: returnId }, include: returnInclude });
  if (!r || !isApprovedLike(r.status)) return null;
  const issued = await rtLineIssued(prisma, r.lines.map((l) => l.id));
  return {
    purchaseReturn: { id: r.id, docNo: r.docNo, status: r.status, vendor: { ...r.vendor, isCustomer: false, isVendor: true }, orderDocNo: r.order.docNo },
    lines: r.lines.map((l) => ({
      returnLineId: l.id,
      productId: l.productId,
      productCode: l.product.code,
      productName: l.product.name,
      unit: l.product.stockUnit?.name ?? "",
      quantity: Number(l.quantity),
      issued: issued.get(l.id) ?? 0,
      remaining: sumQty([l.quantity.toString(), -(issued.get(l.id) ?? 0)]),
    })),
  };
}
export type OpenReturn = NonNullable<Awaited<ReturnType<typeof openReturnLines>>>;

/** ใบส่งคืนที่นำออกได้ (อนุมัติแล้ว ยังคืนไม่ครบ) */
export async function issuableReturns() {
  const docs = await prisma.purchaseReturn.findMany({
    where: { status: { in: ["APPROVED", "PARTIAL"] } },
    include: { vendor: { select: { name: true } } },
    orderBy: { docNo: "desc" },
    take: 200,
  });
  return docs.map((d) => ({ id: d.id, docNo: d.docNo, vendor: d.vendor.name }));
}
