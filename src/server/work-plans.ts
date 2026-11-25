import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { formatDateTime, formatNumber, fullName } from "@/lib/format";
import { bangkokLocalToDate } from "@/lib/date-input";
import { checkPlanAction, isPlanOpen, PLAN_ACTION_LABELS, WORK_PLAN_STATUS_LABELS, type PlanAction, type WorkPlanStatus } from "@/lib/crm";
import { getDistanceProvider, roundKm } from "@/lib/distance";
import { can } from "@/lib/rbac";
import type { WorkPlanData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const ENTITY_PLAN = "WorkPlan";
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export const planInclude = {
  employee: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  customer: { select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } },
  project: { select: { id: true, name: true, customer: { select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } } } },
} satisfies Prisma.WorkPlanInclude;
export type PlanFull = Prisma.WorkPlanGetPayload<{ include: typeof planInclude }>;

const coord = (lat: unknown, lng: unknown) => (lat === null || lat === undefined ? null : `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`);

async function snapshot(tx: TxClient, id: string) {
  const p = await tx.workPlan.findUniqueOrThrow({ where: { id }, include: planInclude });
  return {
    subject: p.subject,
    status: WORK_PLAN_STATUS_LABELS[p.status],
    plannedStart: formatDateTime(p.plannedStart),
    plannedEnd: formatDateTime(p.plannedEnd),
    employee: fullName(p.employee),
    customer: p.customer ? `${p.customer.code} ${p.customer.name}` : null,
    project: p.project?.name ?? null,
    location: p.location,
    detail: p.detail,
    startPoint: coord(p.startLat, p.startLng),
    startAt: p.startAt ? formatDateTime(p.startAt) : null,
    endPoint: coord(p.endLat, p.endLng),
    endAt: p.endAt ? formatDateTime(p.endAt) : null,
    distanceKm: p.distanceKm === null ? null : formatNumber(p.distanceKm.toString(), 3),
  };
}

/** สร้าง/แก้แผนให้คนอื่นต้องมีสิทธิ์สร้าง/แก้ไข; ถ้ามีแค่สิทธิ์ดู สร้างแผนของตัวเองไม่ได้ (ต้องมีสิทธิ์สร้าง) */
async function assertRefs(tx: TxClient, d: WorkPlanData, current?: PlanFull) {
  if (d.employeeId !== current?.employeeId) {
    const u = await tx.user.findUnique({ where: { id: d.employeeId } });
    if (!u || u.status !== "ACTIVE") throw new ApiError(400, "ไม่พบพนักงาน", { employeeId: "ไม่พบผู้ใช้ หรือถูกหยุดใช้งาน" });
  }
  if (d.customerId && d.customerId !== current?.customerId) {
    const c = await tx.contact.findFirst({ where: { id: d.customerId, deletedAt: null } });
    if (!c) throw new ApiError(400, "ไม่พบลูกค้า", { customerId: "ไม่พบลูกค้า" });
  }
  if (d.projectId && d.projectId !== current?.projectId) {
    const p = await tx.project.findFirst({ where: { id: d.projectId, deletedAt: null } });
    if (!p) throw new ApiError(400, "ไม่พบโครงการ", { projectId: "ไม่พบโครงการ" });
    if (d.customerId && p.customerId !== d.customerId) throw new ApiError(400, "โครงการนี้ไม่ใช่ของลูกค้าที่เลือก", { projectId: "โครงการนี้ไม่ใช่ของลูกค้าที่เลือก" });
  }
}

const data = (d: WorkPlanData) => ({
  subject: d.subject,
  plannedStart: bangkokLocalToDate(d.plannedStart)!,
  plannedEnd: bangkokLocalToDate(d.plannedEnd)!,
  employeeId: d.employeeId,
  customerId: d.customerId,
  projectId: d.projectId,
  location: d.location,
  detail: d.detail,
});

export async function createPlan(actor: CurrentUser, d: WorkPlanData, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    await assertRefs(tx, d);
    const p = await tx.workPlan.create({ data: { ...data(d), createdById: actor.id } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PLAN, entityId: p.id, action: "CREATE", after: await snapshot(tx, p.id), ip });
    return p;
  }, TX);
}

async function lockPlan(tx: TxClient, id: string) {
  const [row] = await tx.$queryRaw<{ status: WorkPlanStatus; employeeId: string }[]>`
    SELECT status::text AS status, "employeeId" FROM work_plans WHERE id = ${id} FOR UPDATE`;
  if (!row) throw new ApiError(404, "ไม่พบแผนการทำงาน");
  return row;
}

/** แก้ไขรายละเอียด: ผู้มีสิทธิ์แก้ไข หรือพนักงานเจ้าของแผน (เฉพาะแผนที่ยังไม่จบ; เปลี่ยนพนักงานหลังเช็คอินแล้วไม่ได้) */
export async function updatePlan(actor: CurrentUser, id: string, d: WorkPlanData, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const row = await lockPlan(tx, id);
    if (!can(actor.permissions, "crm.plan", "edit") && row.employeeId !== actor.id) throw new ApiError(403, "ไม่มีสิทธิ์แก้ไขแผนการทำงานนี้");
    if (!isPlanOpen(row.status)) throw new ApiError(409, `แผนที่${WORK_PLAN_STATUS_LABELS[row.status]}แล้ว แก้ไขไม่ได้`);
    if (row.status === "CHECKED_IN" && d.employeeId !== row.employeeId) {
      throw new ApiError(400, "เปลี่ยนพนักงานหลังเช็คอินแล้วไม่ได้", { employeeId: "เปลี่ยนพนักงานหลังเช็คอินแล้วไม่ได้" });
    }
    const current = await tx.workPlan.findUniqueOrThrow({ where: { id }, include: planInclude });
    await assertRefs(tx, d, current);
    const before = await snapshot(tx, id);
    await tx.workPlan.update({ where: { id }, data: { ...data(d), updatedById: actor.id } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PLAN, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
  }, TX);
}

export type PlanActionInput = { action: PlanAction; lat?: number | null; lng?: number | null; accuracy?: number | null; reason?: string | null };

/**
 * เช็คอิน จุดเริ่มต้น / จุดหมาย, เสร็จสิ้น, ยกเลิก
 * เวลาเช็คอินใช้เวลาของ server (ไม่เชื่อเวลาจากเครื่องผู้ใช้); ระยะทางคำนวณตอนเช็คอินจุดหมาย
 */
export async function runPlanAction(actor: CurrentUser, id: string, input: PlanActionInput, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const row = await lockPlan(tx, id);
    const check = checkPlanAction(input.action, row.status, actor.permissions, actor.id, row.employeeId);
    if (!check.ok) throw new ApiError(check.status, check.error);
    const now = new Date();
    const before = await snapshot(tx, id);
    const accuracy = input.accuracy === null || input.accuracy === undefined ? null : Math.round(input.accuracy);
    let data: Prisma.WorkPlanUpdateInput = { status: check.to, updatedById: actor.id };
    if (input.action === "checkin_start") {
      data = { ...data, startLat: input.lat!, startLng: input.lng!, startAccuracy: accuracy, startAt: now };
    } else if (input.action === "checkin_end") {
      const plan = await tx.workPlan.findUniqueOrThrow({ where: { id }, select: { startLat: true, startLng: true } });
      const provider = getDistanceProvider();
      const km = await provider.distanceKm({ lat: Number(plan.startLat), lng: Number(plan.startLng) }, { lat: input.lat!, lng: input.lng! });
      data = { ...data, endLat: input.lat!, endLng: input.lng!, endAccuracy: accuracy, endAt: now, distanceKm: roundKm(km), distanceSource: provider.name, completedAt: now };
    } else if (input.action === "complete") {
      data = { ...data, completedAt: now };
    } else {
      data = { ...data, cancelledAt: now, cancelReason: input.reason?.trim() || null };
    }
    const p = await tx.workPlan.update({ where: { id }, data });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_PLAN,
      entityId: id,
      action: input.action === "cancel" ? "CANCEL" : "STATUS_CHANGE",
      before,
      after: await snapshot(tx, id),
      note: `${PLAN_ACTION_LABELS[input.action]}${input.action === "cancel" && input.reason ? `: ${input.reason}` : ""}`,
      force: true,
      ip,
    });
    return { status: p.status, distanceKm: p.distanceKm === null ? null : Number(p.distanceKm) };
  }, TX);
}

export async function getPlan(id: string) {
  return prisma.workPlan.findUnique({ where: { id }, include: planInclude });
}

export async function getPlanFormOptions() {
  const users = await prisma.user.findMany({
    select: { id: true, firstName: true, lastName: true, department: true, status: true },
    orderBy: [{ status: "asc" }, { firstName: "asc" }],
  });
  return { users: users.map((u) => ({ id: u.id, name: fullName(u), department: u.department, inactive: u.status !== "ACTIVE" })) };
}
export type PlanFormOptions = Awaited<ReturnType<typeof getPlanFormOptions>>;
