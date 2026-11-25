import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ProjectStatus } from "@/lib/crm";
import { projectSchema } from "@/lib/validators";
import { createProject } from "@/server/projects";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["name", "expectedCloseDate", "value", "probability", "createdAt", "updatedAt"];

export type ProjectRow = {
  id: string;
  name: string;
  customer: string;
  salesRep: string | null;
  status: ProjectStatus;
  businessType: string | null;
  probability: number | null;
  expectedCloseDate: string | null;
  value: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

const include = {
  customer: { select: { code: true, name: true } },
  salesRep: { select: { firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  businessType: true,
  workStage: true,
  workNature: true,
  tags: { include: { tag: true } },
} satisfies Prisma.ProjectInclude;

export const GET = apiHandler({ perm: ["crm.project", "view"] }, async ({ req, user }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.ProjectWhereInput[] = [{ deletedAt: null }];
  const status = PROJECT_STATUSES.find((s) => s === p.filters.status);
  if (status) and.push({ status });
  if (p.filters.salesRep === "me") and.push({ salesRepId: user.id });
  else if (p.filters.salesRep) and.push({ salesRepId: p.filters.salesRep });
  if (p.filters.tag) and.push({ tags: { some: { tagId: p.filters.tag } } });
  if (p.filters.customer) and.push({ customerId: p.filters.customer });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { name: contains },
        { workDetail: contains },
        { contactPerson: contains },
        { note: contains },
        { customer: { OR: [{ name: contains }, { code: contains }] } },
        { salesRep: { OR: [{ firstName: contains }, { lastName: contains }] } },
      ],
    });
  }
  const where: Prisma.ProjectWhereInput = { AND: and };
  const orderBy: Prisma.ProjectOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: { sort: p.sort.dir, nulls: "last" } }] : [{ updatedAt: "desc" }];

  if (p.format === "csv") {
    const rows = await prisma.project.findMany({ where, orderBy, include });
    const csv = toCsv(rows, [
      { header: "ชื่อโครงการ", value: (r) => r.name },
      { header: "สถานะ", value: (r) => PROJECT_STATUS_LABELS[r.status] },
      { header: "รหัสลูกค้า", value: (r) => r.customer.code },
      { header: "ลูกค้า", value: (r) => r.customer.name },
      { header: "บุคคลติดต่อ", value: (r) => r.contactPerson },
      { header: "พนักงานขาย", value: (r) => (r.salesRep ? fullName(r.salesRep) : "") },
      { header: "ประเภทกิจการ", value: (r) => r.businessType?.label },
      { header: "ขั้นตอนของงาน", value: (r) => r.workStage?.label },
      { header: "ลักษณะงาน", value: (r) => r.workNature?.label },
      { header: "ข้อมูลลักษณะงาน", value: (r) => r.workDetail },
      { header: "% โอกาสสำเร็จ", value: (r) => r.probability },
      { header: "วันคาดการณ์ปิดดีล", value: (r) => formatDate(r.expectedCloseDate) },
      { header: "มูลค่า", value: (r) => r.value?.toString() },
      { header: "กลุ่ม", value: (r) => r.tags.map((t) => t.tag.name).join(", ") },
      { header: "เริ่มรับประกัน", value: (r) => formatDate(r.warrantyStart) },
      { header: "สิ้นสุดรับประกัน", value: (r) => formatDate(r.warrantyEnd) },
      { header: "หมายเหตุการรับประกัน", value: (r) => r.warrantyNote },
      { header: "หมายเหตุ", value: (r) => r.note },
      { header: "ผู้สร้าง", value: (r) => fullName(r.createdBy) },
      { header: "วันที่สร้าง", value: (r) => formatDateTime(r.createdAt) },
    ]);
    return csvResponse(csv, "projects.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): ProjectRow => ({
        id: r.id,
        name: r.name,
        customer: r.customer.name,
        salesRep: r.salesRep ? fullName(r.salesRep) : null,
        status: r.status,
        businessType: r.businessType?.label ?? null,
        probability: r.probability,
        expectedCloseDate: r.expectedCloseDate?.toISOString() ?? null,
        value: r.value?.toString() ?? null,
        tags: r.tags.map((t) => t.tag.name),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<ProjectRow>;
});

export const POST = apiHandler({ perm: ["crm.project", "create"] }, async ({ req, user, ip }) => {
  const p = await createProject(user, projectSchema.parse(await readJson(req)), ip);
  return { id: p.id };
});
