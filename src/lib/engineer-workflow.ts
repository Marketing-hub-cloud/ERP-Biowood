// Workflow ใบถอดแบบ/ติดตั้ง (EN) — state machine แบบ pure function ใช้ได้ทั้ง client และ server
//
// 1 ร่าง →(ดำเนินการต่อ)→ 2 งานถอดแบบใหม่ →(อนุมัติ)→ 3 ตรวจสอบแล้ว →(ดำเนินการต่อ)→ 4 รับลงคิว
// →(อนุมัติ)→ 5 มอบหมาย →(ดำเนินการต่อ)→ 6 ดำเนินงาน →(แนบไฟล์ แล้วดำเนินการต่อ)→ 7 ตรวจรับงาน
// →(อนุมัติ)→ 8 ใบสรุปประมาณถอดแบบ →(บันทึก)→ 9 เสร็จสิ้น
//
// แต่ละ transition กำหนดสิทธิ์ที่ต้องใช้ (perm) ได้ใน TRANSITIONS — แก้ที่นี่ที่เดียว ทั้ง UI และ server ใช้ร่วมกัน
import { can, type PermissionMap } from "./rbac";
import type { PermissionAction } from "./menu";

export const ENGINEER_MENU = "engineer.document";

export const ENGINEER_STEPS = ["DRAFT", "NEW", "REVIEWED", "QUEUED", "ASSIGNED", "IN_PROGRESS", "INSPECTION", "ESTIMATE", "COMPLETED"] as const;
export type EngineerStep = (typeof ENGINEER_STEPS)[number];
export type EngineerStatus = EngineerStep | "CANCELLED";

export const ENGINEER_STATUS_LABELS: Record<EngineerStatus, string> = {
  DRAFT: "ร่าง",
  NEW: "งานถอดแบบใหม่",
  REVIEWED: "ตรวจสอบแล้ว",
  QUEUED: "รับลงคิว",
  ASSIGNED: "มอบหมาย",
  IN_PROGRESS: "ดำเนินงาน",
  INSPECTION: "ตรวจรับงาน",
  ESTIMATE: "ใบสรุปประมาณถอดแบบ",
  COMPLETED: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
};

export const WORK_TYPE_LABELS = { SURVEY: "ถอดแบบ", INSTALL: "ติดตั้ง", CHANGE: "งานเพิ่ม/ลด" } as const;
export type EngineerWorkType = keyof typeof WORK_TYPE_LABELS;
export const WORK_TYPES = Object.keys(WORK_TYPE_LABELS) as EngineerWorkType[];

export const URGENCY_LABELS = { NORMAL: "ทั่วไป", URGENT: "ด่วน" } as const;
export type EngineerUrgency = keyof typeof URGENCY_LABELS;

export const FILE_KIND_LABELS = { CUSTOMER_DRAWING: "แบบจากลูกค้า", RETURN_DOC: "เอกสารส่งกลับ" } as const;
export type EngineerFileKind = keyof typeof FILE_KIND_LABELS;

/** ข้อมูลเอกสารที่ใช้ตรวจเงื่อนไขก่อนเปลี่ยนขั้น */
export type GuardState = {
  customerId: string | null;
  assigneeId: string | null;
  workTypes: EngineerWorkType[];
  returnDocCount: number;
  estimateLineCount: number;
};

export type Transition = {
  from: EngineerStep;
  to: EngineerStep;
  /** ข้อความบนปุ่ม */
  label: string;
  /** สิทธิ์ของเมนูที่ต้องมี */
  perm: PermissionAction;
  /** ผู้รับผิดชอบงานกดได้แม้ไม่มีสิทธิ์ perm (ต้องดูเมนูได้) */
  assigneeMay?: boolean;
  /** เงื่อนไขก่อนเปลี่ยนขั้น: คืนข้อความ error หรือ null */
  guard?: (s: GuardState) => string | null;
};

export const TRANSITIONS: Transition[] = [
  {
    from: "DRAFT",
    to: "NEW",
    label: "ดำเนินการต่อ",
    perm: "edit",
    guard: (s) => (s.customerId ? null : "กรุณาเลือกลูกค้าก่อนดำเนินการต่อ"),
  },
  { from: "NEW", to: "REVIEWED", label: "อนุมัติ", perm: "approve" },
  { from: "REVIEWED", to: "QUEUED", label: "ดำเนินการต่อ", perm: "edit" },
  {
    from: "QUEUED",
    to: "ASSIGNED",
    label: "อนุมัติ",
    perm: "approve",
    guard: (s) => (s.assigneeId ? null : "กรุณาเลือกผู้รับผิดชอบงานก่อนอนุมัติมอบหมาย"),
  },
  { from: "ASSIGNED", to: "IN_PROGRESS", label: "ดำเนินการต่อ", perm: "edit", assigneeMay: true },
  {
    from: "IN_PROGRESS",
    to: "INSPECTION",
    label: "ดำเนินการต่อ",
    perm: "edit",
    assigneeMay: true,
    guard: (s) => (s.returnDocCount > 0 ? null : "กรุณาแนบ \"เอกสารส่งกลับ\" อย่างน้อย 1 ไฟล์ก่อนดำเนินการต่อ"),
  },
  { from: "INSPECTION", to: "ESTIMATE", label: "อนุมัติ", perm: "approve" },
  {
    from: "ESTIMATE",
    to: "COMPLETED",
    label: "บันทึกเสร็จสิ้น",
    perm: "edit",
    guard: (s) =>
      s.workTypes.includes("SURVEY") && s.estimateLineCount === 0 ? "งานถอดแบบต้องมีรายการในใบสรุปประมาณถอดแบบอย่างน้อย 1 รายการ" : null,
  },
];

export function nextTransition(status: EngineerStatus): Transition | null {
  return TRANSITIONS.find((t) => t.from === status) ?? null;
}

export const stepIndex = (s: EngineerStatus) => ENGINEER_STEPS.indexOf(s as EngineerStep);

/** ผู้ใช้กดเปลี่ยนขั้นนี้ได้หรือไม่ (ตามสิทธิ์ ไม่รวมเงื่อนไขข้อมูล) */
export function canRunTransition(t: Transition, perms: PermissionMap, userId: string, assigneeId: string | null): boolean {
  if (!can(perms, ENGINEER_MENU, "view")) return false;
  if (can(perms, ENGINEER_MENU, t.perm)) return true;
  return Boolean(t.assigneeMay && assigneeId && assigneeId === userId);
}

export type AdvanceCheck = { ok: true; transition: Transition } | { ok: false; status: 400 | 403 | 409; error: string };

/** ตรวจครบทุกข้อก่อนเปลี่ยนขั้น: ขั้นปัจจุบันตรงกับที่ผู้ใช้เห็น, สิทธิ์, เงื่อนไขข้อมูล */
export function checkAdvance(
  current: EngineerStatus,
  expectedFrom: EngineerStatus,
  perms: PermissionMap,
  userId: string,
  state: GuardState,
): AdvanceCheck {
  if (current !== expectedFrom) {
    return { ok: false, status: 409, error: `เอกสารเปลี่ยนเป็น "${ENGINEER_STATUS_LABELS[current]}" แล้ว กรุณารีเฟรชหน้า` };
  }
  const t = nextTransition(current);
  if (!t) return { ok: false, status: 409, error: `เอกสารสถานะ "${ENGINEER_STATUS_LABELS[current]}" ไปขั้นถัดไปไม่ได้` };
  if (!canRunTransition(t, perms, userId, state.assigneeId)) {
    return { ok: false, status: 403, error: `ไม่มีสิทธิ์${t.label} (ต้องมีสิทธิ์ "${t.perm === "approve" ? "อนุมัติ" : "แก้ไข"}" ใบถอดแบบ/ติดตั้ง)` };
  }
  const err = t.guard?.(state);
  if (err) return { ok: false, status: 400, error: err };
  return { ok: true, transition: t };
}

/** แก้ไขข้อมูลเอกสารได้ (ยังไม่เสร็จสิ้น/ยกเลิก) */
export const isEditableStatus = (s: EngineerStatus) => s !== "COMPLETED" && s !== "CANCELLED";

/** แนบ/ลบไฟล์ประเภทนี้ได้ในขั้นนี้หรือไม่ */
export function fileKindOpen(kind: EngineerFileKind, s: EngineerStatus): boolean {
  if (!isEditableStatus(s)) return false;
  if (kind === "CUSTOMER_DRAWING") return true;
  return stepIndex(s) >= stepIndex("ASSIGNED");
}

/** ผู้ใช้แนบ/ลบไฟล์ได้: สิทธิ์แก้ไข หรือผู้รับผิดชอบงาน (เฉพาะเอกสารส่งกลับ) */
export function canManageFile(kind: EngineerFileKind, perms: PermissionMap, userId: string, assigneeId: string | null): boolean {
  if (!can(perms, ENGINEER_MENU, "view")) return false;
  if (can(perms, ENGINEER_MENU, "edit")) return true;
  return kind === "RETURN_DOC" && Boolean(assigneeId) && assigneeId === userId;
}

/** แสดงส่วน "ใบสรุปประมาณถอดแบบ" ตั้งแต่ขั้นดำเนินงาน */
export const showEstimate = (s: EngineerStatus) => s === "CANCELLED" || stepIndex(s) >= stepIndex("IN_PROGRESS");

/** stepper: done / current / todo */
export function engineerStepper(status: EngineerStatus, reached: EngineerStatus | null = null) {
  // ยกเลิก: แสดงขั้นที่ไปถึงก่อนยกเลิกเป็น done
  const cur = status === "CANCELLED" ? stepIndex(reached ?? "DRAFT") : stepIndex(status);
  return ENGINEER_STEPS.map((s, i) => ({
    status: s,
    label: ENGINEER_STATUS_LABELS[s],
    state: status === "COMPLETED" || i < cur || (status === "CANCELLED" && i <= cur) ? ("done" as const) : i === cur ? ("current" as const) : ("todo" as const),
  }));
}

// ───────────── ไฟล์แนบ ─────────────

export const MAX_ENGINEER_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ENGINEER_FILES = 50;

/** นามสกุลที่อนุญาต → content type */
export const ENGINEER_FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".dwg": "application/acad",
  ".dxf": "application/dxf",
  ".skp": "application/vnd.sketchup.skp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
};
export const ENGINEER_FILE_ACCEPT = Object.keys(ENGINEER_FILE_TYPES).join(",");

export function fileExt(name: string): string {
  const m = /\.[^.\\/]+$/.exec(name.trim().toLowerCase());
  return m ? m[0] : "";
}

/** เปิดดูในเบราว์เซอร์ได้ (รูป/PDF) — อย่างอื่นให้ดาวน์โหลด */
export const isInlineType = (contentType: string) => contentType === "application/pdf" || /^image\/(png|jpeg|webp|gif)$/.test(contentType);

export function checkEngineerFile(name: string, size: number): string | null {
  if (!ENGINEER_FILE_TYPES[fileExt(name)]) return `ไม่รองรับไฟล์ชนิดนี้ (รองรับ ${Object.keys(ENGINEER_FILE_TYPES).join(" ")})`;
  if (size <= 0) return "ไฟล์ว่างเปล่า";
  if (size > MAX_ENGINEER_FILE_BYTES) return "ไฟล์ต้องมีขนาดไม่เกิน 25MB";
  return null;
}
