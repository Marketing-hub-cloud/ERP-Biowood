import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { can } from "@/lib/rbac";
import { fullName } from "@/lib/format";
import {
  APPROVAL_DOC_TYPES,
  approveTransition,
  canActOnApproval,
  MAX_APPROVAL_STEPS,
  rejectTransition,
  submitTransition,
  type ApprovalDocState,
  type ApprovalDocType,
  type ApprovalSnapshot,
  type PurchaseStatus,
} from "@/lib/approval";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const ENTITY_APPROVAL_SETTING = "ApprovalSetting";
export const ENTITY_BY_DOC: Record<ApprovalDocType, string> = { PR: "PurchaseRequest", PO: "PurchaseOrder", RT: "PurchaseReturn" };

// ───────────── ตั้งค่าผังอนุมัติ ─────────────

export async function getApprovalConfig(docType: ApprovalDocType) {
  const steps = await prisma.approvalStep.findMany({
    where: { docType },
    orderBy: { stepNo: "asc" },
    include: { approvers: { include: { user: { select: { id: true, firstName: true, lastName: true, status: true } } } } },
  });
  return steps.map((s) => ({
    stepNo: s.stepNo,
    approvers: s.approvers.map((a) => ({ id: a.user.id, name: fullName(a.user), inactive: a.user.status !== "ACTIVE" })),
  }));
}

/** บันทึกผังอนุมัติ: steps = รายชื่อผู้อนุมัติของแต่ละลำดับ ([] = ไม่มีการตั้งค่าการอนุมัติ) */
export async function saveApprovalConfig(actor: CurrentUser, docType: ApprovalDocType, steps: string[][], ip: string | null) {
  if (steps.length > MAX_APPROVAL_STEPS) throw new ApiError(400, `ตั้งได้สูงสุด ${MAX_APPROVAL_STEPS} ลำดับ`);
  const fields: Record<string, string> = {};
  steps.forEach((ids, i) => {
    if (!ids.length) fields[`steps.${i}`] = "กรุณาเลือกผู้อนุมัติอย่างน้อย 1 คน";
  });
  if (Object.keys(fields).length) throw new ApiError(400, Object.values(fields)[0], fields);
  const allIds = [...new Set(steps.flat())];
  const users = await prisma.user.findMany({ where: { id: { in: allIds }, status: "ACTIVE" }, select: { id: true } });
  if (users.length !== allIds.length) throw new ApiError(400, "มีผู้อนุมัติที่ไม่พบหรือถูกหยุดใช้งาน");

  const label = (cfg: { stepNo: number; approvers: { name: string }[] }[]) =>
    Object.fromEntries(cfg.map((s) => [`ลำดับ ${s.stepNo}`, s.approvers.map((a) => a.name).join(", ")]));
  await prisma.$transaction(async (tx) => {
    const before = label(await getApprovalConfigTx(tx, docType));
    await tx.approvalStep.deleteMany({ where: { docType } });
    for (const [i, ids] of steps.entries()) {
      await tx.approvalStep.create({ data: { docType, stepNo: i + 1, approvers: { create: [...new Set(ids)].map((userId) => ({ userId })) } } });
    }
    const after = label(await getApprovalConfigTx(tx, docType));
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_APPROVAL_SETTING,
      entityId: docType,
      action: "UPDATE",
      before: { steps: Object.keys(before).length ? before : "ไม่มีการตั้งค่าการอนุมัติ" },
      after: { steps: Object.keys(after).length ? after : "ไม่มีการตั้งค่าการอนุมัติ" },
      ip,
    });
  });
}

async function getApprovalConfigTx(tx: TxClient, docType: string) {
  const steps = await tx.approvalStep.findMany({
    where: { docType },
    orderBy: { stepNo: "asc" },
    include: { approvers: { include: { user: { select: { id: true, firstName: true, lastName: true, status: true } } } } },
  });
  return steps.map((s) => ({ stepNo: s.stepNo, approvers: s.approvers.map((a) => ({ id: a.user.id, name: fullName(a.user) })) }));
}

/** สำเนาผังอนุมัติปัจจุบัน (เก็บไว้ในเอกสารตอนกด "ส่ง") */
async function buildSnapshot(tx: TxClient, docType: ApprovalDocType): Promise<ApprovalSnapshot> {
  const cfg = await getApprovalConfigTx(tx, docType);
  return { steps: cfg.map((s) => ({ stepNo: s.stepNo, approverIds: s.approvers.map((a) => a.id), approverNames: s.approvers.map((a) => a.name) })) };
}

// ───────────── เอกสาร: lock / update ตามชนิด ─────────────

type DocRow = ApprovalDocState & { docNo: string };

async function lockDoc(tx: TxClient, docType: ApprovalDocType, id: string): Promise<DocRow> {
  const sql =
    docType === "PR"
      ? tx.$queryRaw<RawRow[]>`SELECT "docNo", status::text AS status, "currentStep", "approvalRound", "approvalSnapshot" FROM purchase_requests WHERE id = ${id} FOR UPDATE`
      : docType === "PO"
        ? tx.$queryRaw<RawRow[]>`SELECT "docNo", status::text AS status, "currentStep", "approvalRound", "approvalSnapshot" FROM purchase_orders WHERE id = ${id} FOR UPDATE`
        : tx.$queryRaw<RawRow[]>`SELECT "docNo", status::text AS status, "currentStep", "approvalRound", "approvalSnapshot" FROM purchase_returns WHERE id = ${id} FOR UPDATE`;
  const [r] = await sql;
  if (!r) throw new ApiError(404, `ไม่พบ${APPROVAL_DOC_TYPES[docType].label}`);
  return { docNo: r.docNo, status: r.status, currentStep: r.currentStep, approvalRound: r.approvalRound, approvalSnapshot: r.approvalSnapshot };
}
type RawRow = { docNo: string; status: PurchaseStatus; currentStep: number | null; approvalRound: number; approvalSnapshot: ApprovalSnapshot | null };

type ApprovalUpdate = {
  status: PurchaseStatus;
  currentStep: number | null;
  approvalRound?: number;
  approvalSnapshot?: Prisma.InputJsonValue;
  submittedAt?: Date;
  approvedAt?: Date | null;
  updatedById: string;
};

async function updateDoc(tx: TxClient, docType: ApprovalDocType, id: string, data: ApprovalUpdate) {
  if (docType === "PR") await tx.purchaseRequest.update({ where: { id }, data });
  else if (docType === "PO") await tx.purchaseOrder.update({ where: { id }, data });
  else await tx.purchaseReturn.update({ where: { id }, data });
}

export async function recordApprovalAction(
  tx: TxClient,
  a: { docType: ApprovalDocType; docId: string; round: number; stepNo: number | null; action: "SUBMIT" | "APPROVE" | "REJECT" | "CANCEL"; actorId: string; comment?: string | null },
) {
  await tx.approvalAction.create({ data: { ...a, comment: a.comment ?? null } });
}

export type ApprovalHooks = {
  /** ตรวจเอกสารก่อนส่งอนุมัติ (เช่น ต้องมีรายการ) — throw ApiError ถ้าไม่ผ่าน */
  beforeSubmit?: (tx: TxClient) => Promise<void>;
  /** snapshot สำหรับ audit */
  snapshot: (tx: TxClient) => Promise<Record<string, unknown>>;
};

/**
 * ส่ง / อนุมัติ / ไม่อนุมัติ — ตรวจสิทธิ์ตามผังที่คัดลอกไว้ในเอกสาร ทำใน transaction เดียวกับการเปลี่ยนสถานะ
 * สิทธิ์: ส่ง = แก้ไขเมนูนั้น, อนุมัติ/ไม่อนุมัติ = อยู่ในลำดับปัจจุบัน (หรือมีสิทธิ์ "อนุมัติ" เมื่อไม่ได้ตั้งผัง)
 */
export async function runApproval(
  actor: CurrentUser,
  docType: ApprovalDocType,
  id: string,
  action: "submit" | "approve" | "reject",
  comment: string | null,
  hooks: ApprovalHooks,
  ip: string | null,
) {
  const menuKey = APPROVAL_DOC_TYPES[docType].menuKey;
  return prisma.$transaction(
    async (tx) => {
      const doc = await lockDoc(tx, docType, id);
      const before = await hooks.snapshot(tx);
      let t;
      let stepNo: number | null = doc.currentStep;
      if (action === "submit") {
        if (!can(actor.permissions, menuKey, "edit")) throw new ApiError(403, "ไม่มีสิทธิ์ส่งอนุมัติ");
        await hooks.beforeSubmit?.(tx);
        const snapshot = await buildSnapshot(tx, docType);
        t = submitTransition({ ...doc, approvalSnapshot: snapshot });
        if (typeof t === "string") throw new ApiError(409, t);
        // ไม่มีผังอนุมัติ = รอผู้มีสิทธิ์ "อนุมัติ"
        await updateDoc(tx, docType, id, {
          status: t.status,
          currentStep: t.currentStep,
          approvalRound: t.approvalRound,
          approvalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          submittedAt: new Date(),
          approvedAt: null,
          updatedById: actor.id,
        });
        stepNo = null;
      } else {
        if (!can(actor.permissions, menuKey, "view") || !canActOnApproval(doc, actor.id, can(actor.permissions, menuKey, "approve"))) {
          if (doc.status !== "PENDING") throw new ApiError(409, "เอกสารนี้ไม่ได้อยู่ระหว่างรออนุมัติ");
          throw new ApiError(403, "คุณไม่ใช่ผู้อนุมัติของลำดับนี้");
        }
        if (action === "reject" && !comment?.trim()) throw new ApiError(400, "กรุณากรอกเหตุผลที่ไม่อนุมัติ", { comment: "กรุณากรอกเหตุผล" });
        t = action === "approve" ? approveTransition(doc) : rejectTransition(doc);
        if (typeof t === "string") throw new ApiError(409, t);
        await updateDoc(tx, docType, id, {
          status: t.status,
          currentStep: t.currentStep,
          approvedAt: t.approved ? new Date() : undefined,
          updatedById: actor.id,
        });
      }
      const round = action === "submit" ? doc.approvalRound + 1 : doc.approvalRound;
      const kind = action === "submit" ? "SUBMIT" : action === "approve" ? "APPROVE" : "REJECT";
      await recordApprovalAction(tx, { docType, docId: id, round, stepNo, action: kind, actorId: actor.id, comment });
      const auditAction = action === "submit" ? "STATUS_CHANGE" : action === "approve" ? "APPROVE" : "REJECT";
      const stepText = stepNo ? ` ลำดับ ${stepNo}` : "";
      const note = action === "submit" ? "ส่งอนุมัติ" : action === "approve" ? `อนุมัติ${stepText}` : `ไม่อนุมัติ${stepText}: ${comment}`;
      await writeAudit(tx, {
        actorId: actor.id,
        entityType: ENTITY_BY_DOC[docType],
        entityId: id,
        action: auditAction,
        before,
        after: await hooks.snapshot(tx),
        note: comment && action === "approve" ? `${note} (${comment})` : note,
        force: true,
        ip,
      });
      return { docNo: doc.docNo, status: t.status };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/** ประวัติการอนุมัติของเอกสาร */
export async function approvalHistory(docType: ApprovalDocType, docId: string) {
  const rows = await prisma.approvalAction.findMany({
    where: { docType, docId },
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    round: r.round,
    stepNo: r.stepNo,
    action: r.action,
    actorName: fullName(r.actor),
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
  }));
}
export type ApprovalHistoryEntry = Awaited<ReturnType<typeof approvalHistory>>[number];
