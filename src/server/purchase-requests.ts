import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { allocateDocNumber, DOC_PREFIXES } from "@/lib/doc-number";
import { formatDate, formatNumber, fullName } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/approval";
import { dateOnly, sumQty, toMilli } from "@/lib/stock-rules";
import { prLineOrdered } from "@/lib/purchase-status";
import type { PurchaseRequestData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";
import { approvalHistory, recordApprovalAction, runApproval } from "./approval";
import { assertProducts, assertWarehouse, lockDraft, notifyPurchaseEvent, PURCHASE_TX } from "./purchase-common";

export const ENTITY_PR = "PurchaseRequest";

export const requestInclude = {
  requester: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  cancelledBy: { select: { firstName: true, lastName: true } },
  warehouse: true,
  lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } },
} satisfies Prisma.PurchaseRequestInclude;
export type RequestFull = Prisma.PurchaseRequestGetPayload<{ include: typeof requestInclude }>;

async function snapshot(tx: TxClient, id: string) {
  const d = await tx.purchaseRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
  return {
    docDate: formatDate(d.docDate),
    requiredDate: d.requiredDate ? formatDate(d.requiredDate) : null,
    requester: fullName(d.requester),
    department: d.department,
    position: d.position,
    reference: d.reference,
    warehouse: d.warehouse?.name ?? null,
    note: d.note,
    status: STATUS_LABELS.PR[d.status],
    lines: d.lines.map((l) => `${l.product.code} ${l.product.name} × ${formatNumber(l.quantity.toString())} ${l.product.stockUnit?.name ?? ""}`.trim()),
  };
}

async function assertRefs(tx: TxClient, d: PurchaseRequestData, current?: RequestFull) {
  const u = await tx.user.findUnique({ where: { id: d.requesterId } });
  if (!u || (u.status !== "ACTIVE" && u.id !== current?.requesterId)) throw new ApiError(400, "ไม่พบผู้ขอ", { requesterId: "ไม่พบผู้ขอ" });
  await assertWarehouse(tx, d.warehouseId, current?.warehouseId);
  await assertProducts(tx, d.lines.map((l) => l.productId), new Set(current?.lines.map((l) => l.productId)));
}

const header = (d: PurchaseRequestData) => ({
  docDate: dateOnly(d.docDate),
  requiredDate: d.requiredDate ? dateOnly(d.requiredDate) : null,
  requesterId: d.requesterId,
  department: d.department,
  position: d.position,
  reference: d.reference,
  warehouseId: d.warehouseId,
  note: d.note,
});
const lineRows = (d: PurchaseRequestData) => d.lines.map((l, i) => ({ lineNo: i + 1, productId: l.productId, quantity: l.quantity, note: l.note }));

export async function createRequest(actor: CurrentUser, d: PurchaseRequestData, ip: string | null) {
  const doc = await prisma.$transaction(async (tx) => {
    await assertRefs(tx, d);
    const docNo = await allocateDocNumber(tx, DOC_PREFIXES.PURCHASE_REQUEST);
    const r = await tx.purchaseRequest.create({ data: { ...header(d), docNo, createdById: actor.id, lines: { create: lineRows(d) } } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PR, entityId: r.id, action: "CREATE", after: await snapshot(tx, r.id), ip });
    return r;
  }, PURCHASE_TX);
  notifyPurchaseEvent({ docType: "PR", docId: doc.id, docNo: doc.docNo, event: "created", actorName: fullName(actor) });
  return doc;
}

export async function updateRequest(actor: CurrentUser, id: string, d: PurchaseRequestData, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    await lockDraft(tx, "purchase_requests", id);
    const current = await tx.purchaseRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    await assertRefs(tx, d, current);
    const before = await snapshot(tx, id);
    // ร่างยังไม่เคยอนุมัติ จึงยังไม่มี PO อ้างอิงรายการ — แทนที่รายการทั้งหมดได้
    await tx.purchaseRequestLine.deleteMany({ where: { requestId: id } });
    await tx.purchaseRequest.update({ where: { id }, data: { ...header(d), updatedById: actor.id, lines: { create: lineRows(d) } } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PR, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
  }, PURCHASE_TX);
}

export async function requestApproval(actor: CurrentUser, id: string, action: "submit" | "approve" | "reject", comment: string | null, ip: string | null) {
  const res = await runApproval(
    actor,
    "PR",
    id,
    action,
    comment,
    {
      snapshot: (tx) => snapshot(tx, id),
      beforeSubmit: async (tx) => {
        const n = await tx.purchaseRequestLine.count({ where: { requestId: id } });
        if (!n) throw new ApiError(400, "กรุณาเพิ่มรายการสินค้าก่อนส่งอนุมัติ");
      },
    },
    ip,
  );
  notifyPurchaseEvent({ docType: "PR", docId: id, docNo: res.docNo, event: action, actorName: fullName(actor) });
  return res;
}

export async function cancelRequest(actor: CurrentUser, id: string, reason: string, ip: string | null) {
  const docNo = await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ status: string; docNo: string; approvalRound: number }[]>`
      SELECT status::text AS status, "docNo", "approvalRound" FROM purchase_requests WHERE id = ${id} FOR UPDATE`;
    if (!row) throw new ApiError(404, "ไม่พบใบขอซื้อ");
    if (row.status === "CANCELLED") throw new ApiError(409, "เอกสารนี้ถูกยกเลิกแล้ว");
    const used = await tx.purchaseOrderLine.findMany({
      where: { requestLine: { requestId: id }, order: { status: { not: "CANCELLED" } } },
      include: { order: { select: { docNo: true } } },
    });
    if (used.length) {
      const nos = [...new Set(used.map((u) => u.order.docNo))].join(", ");
      throw new ApiError(409, `ยกเลิกไม่ได้ เพราะมีใบสั่งซื้ออ้างอิงอยู่ (${nos}) กรุณายกเลิกใบสั่งซื้อก่อน`);
    }
    const before = await snapshot(tx, id);
    await tx.purchaseRequest.update({
      where: { id },
      data: { status: "CANCELLED", currentStep: null, cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason, updatedById: actor.id },
    });
    await recordApprovalAction(tx, { docType: "PR", docId: id, round: row.approvalRound, stepNo: null, action: "CANCEL", actorId: actor.id, comment: reason });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PR, entityId: id, action: "CANCEL", before, after: await snapshot(tx, id), note: `ยกเลิก: ${reason}`, ip });
    return row.docNo;
  }, PURCHASE_TX);
  notifyPurchaseEvent({ docType: "PR", docId: id, docNo, event: "cancelled", actorName: fullName(actor) });
}

/** ข้อมูลหน้าเอกสาร: รายการ + จำนวนสั่งซื้อแล้ว + ประวัติอนุมัติ + PO ที่อ้างอิง */
export async function getRequestDetail(id: string) {
  const d = await prisma.purchaseRequest.findUnique({ where: { id }, include: requestInclude });
  if (!d) return null;
  const [ordered, history, orders] = await Promise.all([
    prLineOrdered(prisma, d.lines.map((l) => l.id)),
    approvalHistory("PR", id),
    prisma.purchaseOrder.findMany({
      where: { lines: { some: { requestLine: { requestId: id } } } },
      select: { id: true, docNo: true, status: true },
      orderBy: { docNo: "asc" },
    }),
  ]);
  return { doc: d, ordered, history, orders };
}

/** รายการ PR ที่ยังสั่งซื้อไม่ครบ (ใช้สร้าง PO) */
export async function openRequestLines(requestIds: string[], excludeOrderId?: string | null) {
  const docs = await prisma.purchaseRequest.findMany({
    where: { id: { in: requestIds }, status: { in: ["APPROVED", "PARTIAL"] } },
    include: { lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } } },
    orderBy: { docNo: "asc" },
  });
  const lines = docs.flatMap((d) => d.lines.map((l) => ({ doc: d, line: l })));
  const ordered = await prLineOrdered(prisma, lines.map((x) => x.line.id), excludeOrderId);
  return lines
    .map(({ doc, line }) => ({
      requestLineId: line.id,
      requestDocNo: doc.docNo,
      productId: line.productId,
      productCode: line.product.code,
      productName: line.product.name,
      unit: line.product.stockUnit?.name ?? "",
      quantity: Number(line.quantity),
      remaining: sumQty([line.quantity.toString(), -(ordered.get(line.id) ?? 0)]),
      warehouseId: doc.warehouseId,
    }))
    .filter((l) => toMilli(l.remaining) > 0);
}
export type OpenRequestLine = Awaited<ReturnType<typeof openRequestLines>>[number];
