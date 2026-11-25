// กติกา CRM (pure function ใช้ได้ทั้ง client/server): สถานะโครงการ, สถานะ/การกระทำของแผนการทำงาน
import { can, type PermissionMap } from "./rbac";

// ───────────── โครงการ ─────────────

export const PROJECT_STATUSES = ["NEW", "IN_PROGRESS", "QUOTED", "WON", "CLOSED", "AFTERCARE", "ENGINEERING", "SHIPPING", "PAYMENT"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  NEW: "โครงการใหม่",
  IN_PROGRESS: "กำลังดำเนินการ",
  QUOTED: "เสนอราคา",
  WON: "ปิดได้",
  CLOSED: "จบโครงการ",
  AFTERCARE: "ดูแลงาน",
  ENGINEERING: "ถอดแบบ/ติดตั้ง",
  SHIPPING: "ขนส่ง",
  PAYMENT: "ชำระเงิน",
};

/** % โอกาสสำเร็จ (dropdown 10–100) */
export const PROBABILITY_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

export function projectStepper(status: ProjectStatus) {
  const cur = PROJECT_STATUSES.indexOf(status);
  return PROJECT_STATUSES.map((s, i) => ({
    status: s,
    label: PROJECT_STATUS_LABELS[s],
    state: i < cur ? ("done" as const) : i === cur ? ("current" as const) : ("todo" as const),
  }));
}

// ───────────── แผนการทำงาน ─────────────

export type WorkPlanStatus = "PLANNED" | "CHECKED_IN" | "DONE" | "CANCELLED";
export const WORK_PLAN_STATUS_LABELS: Record<WorkPlanStatus, string> = {
  PLANNED: "วางแผน",
  CHECKED_IN: "เช็คอิน",
  DONE: "เสร็จสิ้น",
  CANCELLED: "ยกเลิก",
};

export type PlanAction = "checkin_start" | "checkin_end" | "complete" | "cancel";
export const PLAN_ACTION_LABELS: Record<PlanAction, string> = {
  checkin_start: "เช็คอิน จุดเริ่มต้น",
  checkin_end: "เช็คอิน จุดหมาย",
  complete: "เสร็จสิ้น",
  cancel: "ยกเลิก",
};

/** สถานะต้นทางที่ทำ action ได้ และสถานะปลายทาง */
const PLAN_FLOW: Record<PlanAction, { from: WorkPlanStatus[]; to: WorkPlanStatus }> = {
  checkin_start: { from: ["PLANNED"], to: "CHECKED_IN" },
  checkin_end: { from: ["CHECKED_IN"], to: "DONE" },
  complete: { from: ["PLANNED", "CHECKED_IN"], to: "DONE" },
  cancel: { from: ["PLANNED", "CHECKED_IN"], to: "CANCELLED" },
};

export const planActionTarget = (a: PlanAction) => PLAN_FLOW[a].to;

export const PLAN_MENU = "crm.plan";

/**
 * ผู้ใช้ทำ action นี้กับแผนนี้ได้หรือไม่
 * - เช็คอิน (บันทึกพิกัด): เฉพาะพนักงานเจ้าของแผน — พิกัดต้องมาจากเครื่องของคนที่ไปหน้างานจริง
 * - เสร็จสิ้นแบบไม่เช็คอิน: เจ้าของแผน หรือผู้มีสิทธิ์แก้ไข
 * - ยกเลิก: เจ้าของแผน หรือผู้มีสิทธิ์ยกเลิก
 */
export function canPlanAction(a: PlanAction, perms: PermissionMap, userId: string, employeeId: string): boolean {
  if (!can(perms, PLAN_MENU, "view")) return false;
  const own = userId === employeeId;
  if (a === "checkin_start" || a === "checkin_end") return own;
  if (a === "complete") return own || can(perms, PLAN_MENU, "edit");
  return own || can(perms, PLAN_MENU, "cancel");
}

export type PlanActionCheck = { ok: true; to: WorkPlanStatus } | { ok: false; status: 403 | 409; error: string };

export function checkPlanAction(a: PlanAction, status: WorkPlanStatus, perms: PermissionMap, userId: string, employeeId: string): PlanActionCheck {
  if (!PLAN_FLOW[a].from.includes(status)) {
    return {
      ok: false,
      status: 409,
      error:
        a === "checkin_end" && status === "PLANNED"
          ? "กรุณาเช็คอินจุดเริ่มต้นก่อน"
          : `แผนการทำงานสถานะ "${WORK_PLAN_STATUS_LABELS[status]}" ${PLAN_ACTION_LABELS[a]}ไม่ได้`,
    };
  }
  if (!canPlanAction(a, perms, userId, employeeId)) {
    return {
      ok: false,
      status: 403,
      error: a.startsWith("checkin") ? "เช็คอินได้เฉพาะพนักงานเจ้าของแผนการทำงาน" : `ไม่มีสิทธิ์${PLAN_ACTION_LABELS[a]}แผนการทำงานนี้`,
    };
  }
  return { ok: true, to: PLAN_FLOW[a].to };
}

/** แก้ไขรายละเอียดได้เมื่อยังไม่เสร็จสิ้น/ยกเลิก */
export const isPlanOpen = (s: WorkPlanStatus) => s === "PLANNED" || s === "CHECKED_IN";

/** ข้อความ error ของ Geolocation API ภาษาไทย */
export function geoErrorMessage(code: number | null | undefined): string {
  switch (code) {
    case 1:
      return "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาอนุญาตการเข้าถึงตำแหน่งในเบราว์เซอร์ แล้วลองใหม่";
    case 2:
      return "หาตำแหน่งไม่ได้ กรุณาเปิด GPS/ตำแหน่งของเครื่อง แล้วลองใหม่";
    case 3:
      return "หาตำแหน่งนานเกินไป กรุณาลองใหม่ในที่ที่สัญญาณดีขึ้น";
    default:
      return "เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง (ต้องเปิดผ่าน https)";
  }
}
