import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { dateRangeFilter } from "@/lib/list-filters";
import { ENGINEER_STATUS_LABELS, URGENCY_LABELS, WORK_TYPE_LABELS, type EngineerStatus, type EngineerUrgency, type EngineerWorkType } from "@/lib/engineer-workflow";
import { engineerDocSchema } from "@/lib/validators";
import { createEngineerDoc } from "@/server/engineer-docs";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["docNo", "docDate", "dueDate", "projectName", "createdAt"];
const STATUSES = Object.keys(ENGINEER_STATUS_LABELS) as EngineerStatus[];

export type EngineerRow = {
  id: string;
  docNo: string;
  docDate: string;
  dueDate: string | null;
  projectName: string;
  customer: string | null;
  workTypes: EngineerWorkType[];
  urgency: EngineerUrgency;
  assignee: string | null;
  revision: number;
  status: EngineerStatus;
  createdBy: string;
  createdAt: string;
};

const include = {
  customer: { select: { code: true, name: true } },
  assignee: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  participants: { include: { user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.EngineerDocInclude;

export const GET = apiHandler({ perm: ["engineer.document", "view"] }, async ({ req, user }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.EngineerDocWhereInput[] = [];
  const status = STATUSES.find((s) => s === p.filters.status);
  if (status) and.push({ status });
  else if (p.filters.status === "open") and.push({ status: { notIn: ["COMPLETED", "CANCELLED"] } });
  if (p.filters.urgency === "NORMAL" || p.filters.urgency === "URGENT") and.push({ urgency: p.filters.urgency });
  const wt = (Object.keys(WORK_TYPE_LABELS) as EngineerWorkType[]).find((w) => w === p.filters.workType);
  if (wt) and.push({ workTypes: { has: wt } });
  if (p.filters.mine === "1") and.push({ OR: [{ assigneeId: user.id }, { createdById: user.id }, { participants: { some: { userId: user.id } } }] });
  const range = dateRangeFilter(p.filters);
  if (range) and.push({ docDate: range });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { docNo: contains },
        { projectName: contains },
        { workDetail: contains },
        { siteAddress: contains },
        { note: contains },
        { customer: { OR: [{ name: contains }, { code: contains }] } },
        { assignee: { OR: [{ firstName: contains }, { lastName: contains }] } },
      ],
    });
  }
  const where: Prisma.EngineerDocWhereInput = { AND: and };
  const orderBy: Prisma.EngineerDocOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: p.sort.dir }] : [{ docDate: "desc" }, { docNo: "desc" }];

  if (p.format === "csv") {
    const docs = await prisma.engineerDoc.findMany({ where, orderBy, include });
    const csv = toCsv(docs, [
      { header: "เลขที่เอกสาร", value: (d) => d.docNo },
      { header: "วันที่ออกเอกสาร", value: (d) => formatDate(d.docDate) },
      { header: "วันที่เริ่มงาน", value: (d) => formatDate(d.startDate) },
      { header: "วันที่กำหนดส่ง", value: (d) => formatDate(d.dueDate) },
      { header: "ครั้งที่", value: (d) => d.revision },
      { header: "ชื่อโครงการ", value: (d) => d.projectName },
      { header: "รหัสลูกค้า", value: (d) => d.customer?.code },
      { header: "ลูกค้า", value: (d) => d.customer?.name },
      { header: "ที่อยู่", value: (d) => d.siteAddress },
      { header: "ประเภทงาน", value: (d) => d.workTypes.map((w) => WORK_TYPE_LABELS[w]).join(", ") },
      { header: "ข้อมูลลักษณะงาน", value: (d) => d.workDetail },
      { header: "ความเร่งด่วน", value: (d) => URGENCY_LABELS[d.urgency] },
      { header: "ผู้รับผิดชอบงาน", value: (d) => (d.assignee ? fullName(d.assignee) : "") },
      { header: "ผู้เกี่ยวข้อง", value: (d) => d.participants.map((x) => fullName(x.user)).join(", ") },
      { header: "สถานะ", value: (d) => ENGINEER_STATUS_LABELS[d.status] },
      { header: "หมายเหตุ", value: (d) => d.note },
      { header: "ผู้สร้าง", value: (d) => fullName(d.createdBy) },
      { header: "วันที่สร้าง", value: (d) => formatDateTime(d.createdAt) },
    ]);
    return csvResponse(csv, "engineer-documents.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.engineerDoc.count({ where }),
    prisma.engineerDoc.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): EngineerRow => ({
        id: r.id,
        docNo: r.docNo,
        docDate: r.docDate.toISOString(),
        dueDate: r.dueDate?.toISOString() ?? null,
        projectName: r.projectName,
        customer: r.customer?.name ?? null,
        workTypes: r.workTypes,
        urgency: r.urgency,
        assignee: r.assignee ? fullName(r.assignee) : null,
        revision: r.revision,
        status: r.status,
        createdBy: fullName(r.createdBy),
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<EngineerRow>;
});

export const POST = apiHandler({ perm: ["engineer.document", "create"] }, async ({ req, user, ip }) => {
  const r = await createEngineerDoc(user, engineerDocSchema.parse(await readJson(req)), ip);
  return { id: r.id, docNo: r.docNo };
});
