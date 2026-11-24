// Approval engine (logic ล้วน ไม่แตะ DB) — ใช้ร่วม PR / PO / ใบส่งคืน และโมดูลอื่นในอนาคต
// - ไม่มีผังอนุมัติ: ใครมีสิทธิ์ "อนุมัติ" ของเมนูก็กดได้ (อนุมัติครั้งเดียวจบ)
// - มีผังอนุมัติ: สูงสุด 3 ลำดับ แต่ละลำดับมีผู้อนุมัติหลายคน คนใดคนหนึ่งกดก็ไปลำดับถัดไป
// - ไม่อนุมัติ (ต้องมีเหตุผล) → กลับเป็นร่าง; ส่งใหม่ = รอบใหม่ เริ่มลำดับ 1
// - ผังที่ใช้ถูกคัดลอกไว้ในเอกสารตอนกด "ส่ง" (แก้ตั้งค่าภายหลังไม่กระทบใบที่รออยู่)

export const MAX_APPROVAL_STEPS = 3;

export type PurchaseStatus = "DRAFT" | "PENDING" | "APPROVED" | "PARTIAL" | "COMPLETED" | "CANCELLED";
export type ApprovalSnapshot = { steps: { stepNo: number; approverIds: string[]; approverNames: string[] }[] };

export type ApprovalDocState = {
  status: PurchaseStatus;
  currentStep: number | null;
  approvalRound: number;
  approvalSnapshot: ApprovalSnapshot | null;
};

export const APPROVAL_DOC_TYPES = {
  PR: { label: "ใบขอซื้อ", menuKey: "purchase.request" },
  PO: { label: "ใบสั่งซื้อ", menuKey: "purchase.order" },
  RT: { label: "ใบส่งคืน", menuKey: "purchase.return" },
} as const;
export type ApprovalDocType = keyof typeof APPROVAL_DOC_TYPES;

export const APPROVAL_ACTION_LABELS = { SUBMIT: "ส่งอนุมัติ", APPROVE: "อนุมัติ", REJECT: "ไม่อนุมัติ", CANCEL: "ยกเลิก" } as const;

/** ชื่อสถานะตามชนิดเอกสาร */
export const STATUS_LABELS: Record<ApprovalDocType, Record<PurchaseStatus, string>> = {
  PR: { DRAFT: "ร่าง", PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", PARTIAL: "สั่งซื้อแล้วบางส่วน", COMPLETED: "สั่งซื้อแล้ว", CANCELLED: "ยกเลิก" },
  PO: { DRAFT: "ร่าง", PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", PARTIAL: "นำเข้าแล้วบางส่วน", COMPLETED: "นำเข้าแล้ว", CANCELLED: "ยกเลิก" },
  RT: { DRAFT: "ร่าง", PENDING: "รออนุมัติ", APPROVED: "อนุมัติแล้ว", PARTIAL: "ส่งคืนแล้วบางส่วน", COMPLETED: "ส่งคืนแล้ว", CANCELLED: "ยกเลิก" },
};

/** หลังอนุมัติแล้ว (รวมบางส่วน/ครบ) */
export const isApprovedLike = (s: PurchaseStatus) => s === "APPROVED" || s === "PARTIAL" || s === "COMPLETED";

/** ผู้ใช้คนนี้อนุมัติ/ไม่อนุมัติ เอกสารนี้ได้ตอนนี้หรือไม่ (hasApprovePerm = สิทธิ์ "อนุมัติ" ของเมนู) */
export function canActOnApproval(doc: ApprovalDocState, userId: string, hasApprovePerm: boolean): boolean {
  if (doc.status !== "PENDING") return false;
  const steps = doc.approvalSnapshot?.steps ?? [];
  if (!steps.length) return hasApprovePerm;
  const step = steps.find((s) => s.stepNo === doc.currentStep);
  return Boolean(step?.approverIds.includes(userId));
}

export type Transition = { status: PurchaseStatus; currentStep: number | null; approvalRound?: number; approved?: boolean };

/** กด "ส่ง": ร่าง → รออนุมัติ (ลำดับ 1) */
export function submitTransition(doc: ApprovalDocState): Transition | string {
  if (doc.status !== "DRAFT") return "ส่งอนุมัติได้เฉพาะเอกสารที่เป็นร่าง";
  const steps = doc.approvalSnapshot?.steps ?? [];
  return { status: "PENDING", currentStep: steps.length ? steps[0].stepNo : null, approvalRound: doc.approvalRound + 1 };
}

/** กด "อนุมัติ": ไปลำดับถัดไป หรือ "อนุมัติแล้ว" เมื่อครบทุกลำดับ */
export function approveTransition(doc: ApprovalDocState): Transition | string {
  if (doc.status !== "PENDING") return "เอกสารนี้ไม่ได้อยู่ระหว่างรออนุมัติ";
  const steps = doc.approvalSnapshot?.steps ?? [];
  const idx = steps.findIndex((s) => s.stepNo === doc.currentStep);
  const next = idx >= 0 ? steps[idx + 1] : undefined;
  if (next) return { status: "PENDING", currentStep: next.stepNo };
  return { status: "APPROVED", currentStep: null, approved: true };
}

/** กด "ไม่อนุมัติ": กลับเป็นร่าง */
export function rejectTransition(doc: ApprovalDocState): Transition | string {
  if (doc.status !== "PENDING") return "เอกสารนี้ไม่ได้อยู่ระหว่างรออนุมัติ";
  return { status: "DRAFT", currentStep: null };
}

/** สถานะหลังอนุมัติจากความคืบหน้าของแต่ละรายการ (done = สั่งซื้อ/รับ/คืน แล้ว) — หน่วยเป็น 1/1000 */
export function fulfillmentStatus(lines: { qtyMilli: number; doneMilli: number }[]): "APPROVED" | "PARTIAL" | "COMPLETED" {
  if (!lines.length) return "APPROVED";
  if (lines.every((l) => l.doneMilli >= l.qtyMilli)) return "COMPLETED";
  if (lines.some((l) => l.doneMilli > 0)) return "PARTIAL";
  return "APPROVED";
}

/** ขั้นของ stepper หัวเอกสาร */
export function statusSteps(docType: ApprovalDocType, status: PurchaseStatus): { label: string; state: "done" | "current" | "todo" }[] {
  const order: PurchaseStatus[] = ["DRAFT", "PENDING", "APPROVED", "PARTIAL", "COMPLETED"];
  const labels = STATUS_LABELS[docType];
  const cur = order.indexOf(status);
  return order.map((s, i) => ({ label: labels[s], state: status === "CANCELLED" ? "todo" : i < cur ? "done" : i === cur ? "current" : "todo" }));
}
