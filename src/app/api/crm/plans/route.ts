import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDateTime, formatNumber, fullName } from "@/lib/format";
import { bangkokLocalToDate } from "@/lib/date-input";
import { WORK_PLAN_STATUS_LABELS, type WorkPlanStatus } from "@/lib/crm";
import { workPlanSchema } from "@/lib/validators";
import { createPlan } from "@/server/work-plans";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["plannedStart", "subject", "createdAt"];
const STATUSES = Object.keys(WORK_PLAN_STATUS_LABELS) as WorkPlanStatus[];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type PlanRow = {
  id: string;
  subject: string;
  status: WorkPlanStatus;
  plannedStart: string;
  plannedEnd: string;
  employee: string;
  employeeId: string;
  customer: string | null;
  project: string | null;
  location: string | null;
  distanceKm: number | null;
};

const include = {
  employee: { select: { firstName: true, lastName: true } },
  customer: { select: { code: true, name: true } },
  project: { select: { name: true } },
} satisfies Prisma.WorkPlanInclude;

/**
 * รายการแผนการทำงาน: กรอง f_employee (id หรือ "me"), f_status, f_from/f_to (วันที่ไทย YYYY-MM-DD ของวันเวลาเริ่ม)
 * ปฏิทินเรียกด้วย pageSize ใหญ่ + ช่วงวันที่ของเดือน
 */
export const GET = apiHandler({ perm: ["crm.plan", "view"] }, async ({ req, user }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.WorkPlanWhereInput[] = [];
  const status = STATUSES.find((s) => s === p.filters.status);
  if (status) and.push({ status });
  if (p.filters.employee === "me") and.push({ employeeId: user.id });
  else if (p.filters.employee) and.push({ employeeId: p.filters.employee });
  if (p.filters.project) and.push({ projectId: p.filters.project });
  const from = ISO.test(p.filters.from ?? "") ? bangkokLocalToDate(`${p.filters.from}T00:00`) : null;
  const to = ISO.test(p.filters.to ?? "") ? bangkokLocalToDate(`${p.filters.to}T00:00`) : null;
  if (from) and.push({ plannedStart: { gte: from } });
  if (to) and.push({ plannedStart: { lt: new Date(to.getTime() + 24 * 3600_000) } });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { subject: contains },
        { location: contains },
        { detail: contains },
        { customer: { name: contains } },
        { project: { name: contains } },
        { employee: { OR: [{ firstName: contains }, { lastName: contains }] } },
      ],
    });
  }
  const where: Prisma.WorkPlanWhereInput = { AND: and };
  const orderBy: Prisma.WorkPlanOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: p.sort.dir }] : [{ plannedStart: "desc" }];

  if (p.format === "csv") {
    const rows = await prisma.workPlan.findMany({ where, orderBy, include });
    const csv = toCsv(rows, [
      { header: "เรื่อง", value: (r) => r.subject },
      { header: "สถานะ", value: (r) => WORK_PLAN_STATUS_LABELS[r.status] },
      { header: "เริ่ม (วางแผน)", value: (r) => formatDateTime(r.plannedStart) },
      { header: "สิ้นสุด (วางแผน)", value: (r) => formatDateTime(r.plannedEnd) },
      { header: "พนักงาน", value: (r) => fullName(r.employee) },
      { header: "ลูกค้า", value: (r) => r.customer?.name },
      { header: "โครงการ", value: (r) => r.project?.name },
      { header: "สถานที่", value: (r) => r.location },
      { header: "เช็คอินเริ่มต้น", value: (r) => formatDateTime(r.startAt) },
      { header: "พิกัดเริ่มต้น", value: (r) => (r.startLat === null ? "" : `${r.startLat},${r.startLng}`) },
      { header: "เช็คอินจุดหมาย", value: (r) => formatDateTime(r.endAt) },
      { header: "พิกัดจุดหมาย", value: (r) => (r.endLat === null ? "" : `${r.endLat},${r.endLng}`) },
      { header: "ระยะทาง (กม.)", value: (r) => (r.distanceKm === null ? "" : formatNumber(r.distanceKm.toString(), 3)) },
      { header: "รายละเอียด", value: (r) => r.detail },
    ]);
    return csvResponse(csv, "work-plans.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.workPlan.count({ where }),
    prisma.workPlan.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): PlanRow => ({
        id: r.id,
        subject: r.subject,
        status: r.status,
        plannedStart: r.plannedStart.toISOString(),
        plannedEnd: r.plannedEnd.toISOString(),
        employee: fullName(r.employee),
        employeeId: r.employeeId,
        customer: r.customer?.name ?? null,
        project: r.project?.name ?? null,
        location: r.location,
        distanceKm: r.distanceKm === null ? null : Number(r.distanceKm),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<PlanRow>;
});

export const POST = apiHandler({ perm: ["crm.plan", "create"] }, async ({ req, user, ip }) => {
  const p = await createPlan(user, workPlanSchema.parse(await readJson(req)), ip);
  return { id: p.id };
});
