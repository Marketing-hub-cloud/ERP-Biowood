// แจ้งเตือน: ในระบบ (กระดิ่ง) + LINE (คิว outbox)
// เรียก enqueuePurchaseEvent ภายใน transaction เดียวกับการบันทึกเอกสาร → เอกสารบันทึกสำเร็จ = มีแจ้งเตือน/คิวแน่นอน
// การส่ง LINE จริงทำโดย worker ภายหลัง (src/lib/notification-worker.ts) ส่งล้มไม่กระทบเอกสาร
import { APPROVAL_DOC_TYPES, STATUS_LABELS, type ApprovalDocType, type ApprovalSnapshot, type PurchaseStatus } from "./approval";
import { fullName } from "./format";
import type { DbClient, TxClient } from "./db";

export const NOTIFY_MODULES = {
  purchase: { label: "จัดซื้อ", lineGroup: "Biowood - จัดซื้อ" },
  engineer: { label: "ถอดแบบ/ติดตั้ง", lineGroup: "Biowood - ถอดแบบติดตั้ง" },
} as const;
export type NotifyModule = keyof typeof NOTIFY_MODULES;

/** ระยะรอก่อนส่งใหม่ หลังล้มครั้งที่ 1..5 — ล้มครั้งที่ 6 = ส่งไม่สำเร็จ */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** เวลาส่งครั้งถัดไป หลังล้มไปแล้ว attempts ครั้ง (null = เลิกส่ง) */
export function nextAttemptAfter(attempts: number, now = new Date()): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return new Date(now.getTime() + RETRY_DELAYS_MS[Math.max(0, attempts - 1)]);
}

export const DOC_PATHS: Record<ApprovalDocType, string> = { PR: "/purchase/requests", PO: "/purchase/orders", RT: "/purchase/returns" };
export const docLink = (docType: ApprovalDocType, id: string) => `${DOC_PATHS[docType]}/${id}`;
export const appBaseUrl = () => (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export type PurchaseEventKind = "created" | "submitted" | "step_approved" | "approved" | "rejected" | "cancelled" | "status";
export type PurchaseEvent = {
  kind: PurchaseEventKind;
  docType: ApprovalDocType;
  docId: string;
  docNo: string;
  status: PurchaseStatus;
  actorId: string | null;
  /** ลำดับที่เพิ่งอนุมัติ (step_approved/approved) */
  stepNo?: number | null;
  /** ลำดับที่รออนุมัติต่อ (submitted/step_approved) */
  nextStep?: number | null;
  comment?: string | null;
};

const EVENT_LABEL: Record<PurchaseEventKind, string> = {
  created: "สร้างเอกสาร",
  submitted: "ส่งอนุมัติ",
  step_approved: "อนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  cancelled: "ยกเลิก",
  status: "เปลี่ยนสถานะ",
};

/** ข้อความ LINE: เลขที่เอกสาร, สถานะ, ผู้ทำ, ลิงก์เข้าเอกสาร */
export function purchaseLineText(e: PurchaseEvent, actorName: string | null): string {
  const doc = APPROVAL_DOC_TYPES[e.docType].label;
  const event = e.kind === "step_approved" || (e.kind === "approved" && e.stepNo) ? `อนุมัติลำดับ ${e.stepNo}` : EVENT_LABEL[e.kind];
  const statusText = `${STATUS_LABELS[e.docType][e.status]}${e.status === "PENDING" && e.nextStep ? ` (ลำดับ ${e.nextStep})` : ""}`;
  const lines = [`[${NOTIFY_MODULES.purchase.label}] ${event} ${doc} ${e.docNo}`, `สถานะ: ${statusText}`, `โดย: ${actorName ?? "ระบบ"}`];
  if (e.comment) lines.push(`${e.kind === "rejected" || e.kind === "cancelled" ? "เหตุผล" : "ความเห็น"}: ${e.comment}`);
  lines.push(`${appBaseUrl()}${docLink(e.docType, e.docId)}`);
  return lines.join("\n");
}

type InApp = { title: string; body: string | null };

/** ข้อความแจ้งเตือนในระบบ แยกตามบทบาทผู้รับ */
export function purchaseInAppText(e: PurchaseEvent, role: "approver" | "owner", actorName: string | null): InApp | null {
  const doc = `${APPROVAL_DOC_TYPES[e.docType].label} ${e.docNo}`;
  const by = actorName ? ` โดย ${actorName}` : "";
  if (role === "approver") {
    if (e.kind !== "submitted" && e.kind !== "step_approved") return null;
    return { title: `${doc} รออนุมัติจากคุณ`, body: `${e.nextStep ? `ลำดับ ${e.nextStep} · ` : ""}${e.kind === "submitted" ? "ส่งอนุมัติ" : `อนุมัติลำดับ ${e.stepNo} แล้ว`}${by}` };
  }
  switch (e.kind) {
    case "approved":
      return { title: `${doc} อนุมัติแล้ว`, body: `${by.trim()}${e.comment ? ` · ${e.comment}` : ""}` || null };
    case "rejected":
      return { title: `${doc} ไม่อนุมัติ`, body: `${e.comment ? `เหตุผล: ${e.comment}` : ""}${by}`.trim() || null };
    case "cancelled":
      return { title: `${doc} ถูกยกเลิก`, body: `${e.comment ? `เหตุผล: ${e.comment}` : ""}${by}`.trim() || null };
    case "status":
      return { title: `${doc} ${STATUS_LABELS[e.docType][e.status]}`, body: by.trim() || null };
    default:
      return null;
  }
}

/** ผู้ที่อนุมัติลำดับนี้ได้: ตามผังที่คัดลอกไว้ หรือถ้าไม่มีผัง = ผู้มีสิทธิ์ "อนุมัติ" ของเมนู (รวม admin) */
async function approverIds(db: TxClient | DbClient, docType: ApprovalDocType, snapshot: ApprovalSnapshot | null, step: number | null): Promise<string[]> {
  const steps = snapshot?.steps ?? [];
  if (steps.length) return steps.find((s) => s.stepNo === step)?.approverIds ?? [];
  const menuKey = APPROVAL_DOC_TYPES[docType].menuKey;
  const users = await db.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ isAdmin: true }, { groups: { some: { group: { permissions: { some: { menuKey, canView: true, canApprove: true } } } } } }],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function loadDoc(db: TxClient | DbClient, docType: ApprovalDocType, id: string) {
  const sel = { createdById: true, approvalSnapshot: true, currentStep: true } as const;
  if (docType === "PR") {
    const d = await db.purchaseRequest.findUnique({ where: { id }, select: { ...sel, requesterId: true } });
    return d && { owners: [d.createdById, d.requesterId], snapshot: d.approvalSnapshot as ApprovalSnapshot | null, currentStep: d.currentStep };
  }
  const d = docType === "PO" ? await db.purchaseOrder.findUnique({ where: { id }, select: sel }) : await db.purchaseReturn.findUnique({ where: { id }, select: sel });
  return d && { owners: [d.createdById], snapshot: d.approvalSnapshot as ApprovalSnapshot | null, currentStep: d.currentStep };
}

/**
 * บันทึกแจ้งเตือนในระบบ + คิว LINE ของเหตุการณ์เอกสารจัดซื้อ (เรียกใน transaction ของเอกสาร)
 * - ไม่แจ้งเตือนผู้ที่กดเอง และผู้ใช้ที่ถูกหยุดใช้งาน
 * - LINE: เฉพาะเมื่อเปิดใช้และเลือกกลุ่มไว้ (ถ้ายังไม่ตั้ง token ข้อความจะรอในคิวจนกว่าจะตั้ง)
 */
export async function enqueuePurchaseEvent(tx: TxClient, e: PurchaseEvent) {
  const actor = e.actorId ? await tx.user.findUnique({ where: { id: e.actorId }, select: { firstName: true, lastName: true } }) : null;
  const actorName = actor ? fullName(actor) : null;
  const doc = await loadDoc(tx, e.docType, e.docId);
  if (!doc) return;

  // ───── ในระบบ ─────
  const rows: { userId: string; title: string; body: string | null }[] = [];
  if (e.kind === "submitted" || e.kind === "step_approved") {
    const text = purchaseInAppText(e, "approver", actorName);
    for (const id of await approverIds(tx, e.docType, doc.snapshot, e.nextStep ?? doc.currentStep)) if (text) rows.push({ userId: id, ...text });
  } else {
    const text = purchaseInAppText(e, "owner", actorName);
    if (text) for (const id of new Set(doc.owners)) rows.push({ userId: id, ...text });
  }
  const recipients = [...new Map(rows.filter((r) => r.userId !== e.actorId).map((r) => [r.userId, r])).values()];
  if (recipients.length) {
    const active = new Set(
      (await tx.user.findMany({ where: { id: { in: recipients.map((r) => r.userId) }, status: "ACTIVE" }, select: { id: true } })).map((u) => u.id),
    );
    await tx.notification.createMany({
      data: recipients
        .filter((r) => active.has(r.userId))
        .map((r) => ({ userId: r.userId, module: "purchase", title: r.title, body: r.body, link: docLink(e.docType, e.docId), docType: e.docType, docId: e.docId })),
    });
  }

  // ───── LINE (outbox) ─────
  await enqueueLine(tx, "purchase", purchaseLineText(e, actorName), { refType: e.docType, refId: e.docId });
}

/** เพิ่มข้อความเข้าคิว LINE ของโมดูล (ถ้าเปิดใช้และเลือกกลุ่มไว้) — คืน id ของคิว หรือ null */
export async function enqueueLine(tx: TxClient | DbClient, module: NotifyModule, message: string, ref: { refType?: string; refId?: string } = {}) {
  const setting = await tx.notificationSetting.findUnique({ where: { module } });
  if (!setting?.lineEnabled || !setting.lineGroupId) return null;
  const d = await tx.notificationDelivery.create({ data: { module, target: setting.lineGroupId, message, refType: ref.refType ?? null, refId: ref.refId ?? null } });
  return d.id;
}
