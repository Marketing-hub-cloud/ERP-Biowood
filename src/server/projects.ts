import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { formatDate, formatNumber, fullName } from "@/lib/format";
import { dateOnly } from "@/lib/stock-rules";
import { PROJECT_STATUS_LABELS } from "@/lib/crm";
import type { ProjectData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const ENTITY_PROJECT = "Project";
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export const projectInclude = {
  customer: { select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } },
  salesRep: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  businessType: true,
  workStage: true,
  workNature: true,
  tags: { include: { tag: true } },
} satisfies Prisma.ProjectInclude;
export type ProjectFull = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

async function snapshot(tx: TxClient, id: string) {
  const p = await tx.project.findUniqueOrThrow({ where: { id }, include: projectInclude });
  return {
    name: p.name,
    status: PROJECT_STATUS_LABELS[p.status],
    customer: `${p.customer.code} ${p.customer.name}`,
    contactPerson: p.contactPerson,
    salesRep: p.salesRep ? fullName(p.salesRep) : null,
    businessType: p.businessType?.label ?? null,
    workStage: p.workStage?.label ?? null,
    workNature: p.workNature?.label ?? null,
    workDetail: p.workDetail,
    probability: p.probability === null ? null : `${p.probability}%`,
    expectedCloseDate: p.expectedCloseDate ? formatDate(p.expectedCloseDate) : null,
    value: p.value === null ? null : formatNumber(p.value.toString(), 2),
    tags: p.tags.map((t) => t.tag.name).sort(),
    warrantyStart: p.warrantyStart ? formatDate(p.warrantyStart) : null,
    warrantyEnd: p.warrantyEnd ? formatDate(p.warrantyEnd) : null,
    warrantyNote: p.warrantyNote,
    note: p.note,
  };
}

const LOOKUP_KIND = { businessTypeId: "CUSTOMER_BUSINESS_TYPE", workStageId: "PROJECT_WORK_STAGE", workNatureId: "PROJECT_WORK_NATURE" } as const;

async function assertRefs(tx: TxClient, d: ProjectData, current?: ProjectFull) {
  if (d.customerId !== current?.customerId) {
    const c = await tx.contact.findFirst({ where: { id: d.customerId, deletedAt: null } });
    if (!c) throw new ApiError(400, "ไม่พบลูกค้า", { customerId: "ไม่พบลูกค้า" });
    if (!c.isCustomer) throw new ApiError(400, "ผู้ติดต่อนี้ไม่ได้เป็นลูกค้า", { customerId: "ผู้ติดต่อนี้ไม่ได้เป็นลูกค้า" });
  }
  if (d.salesRepId && d.salesRepId !== current?.salesRepId) {
    const u = await tx.user.findUnique({ where: { id: d.salesRepId } });
    if (!u || u.status !== "ACTIVE") throw new ApiError(400, "ไม่พบพนักงานขาย", { salesRepId: "ไม่พบผู้ใช้ หรือถูกหยุดใช้งาน" });
  }
  for (const [field, kind] of Object.entries(LOOKUP_KIND) as [keyof typeof LOOKUP_KIND, (typeof LOOKUP_KIND)[keyof typeof LOOKUP_KIND]][]) {
    const id = d[field];
    if (!id || id === current?.[field]) continue;
    const o = await tx.lookupOption.findFirst({ where: { id, kind, isActive: true } });
    if (!o) throw new ApiError(400, "ไม่พบตัวเลือก", { [field]: "ไม่พบตัวเลือก" });
  }
  if (d.tagIds.length) {
    const n = await tx.tag.count({ where: { id: { in: d.tagIds } } });
    if (n !== d.tagIds.length) throw new ApiError(400, "ไม่พบกลุ่ม (tag) บางรายการ", { tagIds: "ไม่พบกลุ่มบางรายการ" });
  }
}

const data = (d: ProjectData) => ({
  name: d.name,
  status: d.status,
  customerId: d.customerId,
  contactPerson: d.contactPerson,
  salesRepId: d.salesRepId,
  businessTypeId: d.businessTypeId,
  workStageId: d.workStageId,
  workNatureId: d.workNatureId,
  workDetail: d.workDetail,
  probability: d.probability,
  expectedCloseDate: d.expectedCloseDate ? dateOnly(d.expectedCloseDate) : null,
  value: d.value,
  warrantyStart: d.warrantyStart ? dateOnly(d.warrantyStart) : null,
  warrantyEnd: d.warrantyEnd ? dateOnly(d.warrantyEnd) : null,
  warrantyNote: d.warrantyNote,
  note: d.note,
});

export async function createProject(actor: CurrentUser, d: ProjectData, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    await assertRefs(tx, d);
    const p = await tx.project.create({
      data: { ...data(d), createdById: actor.id, tags: { create: d.tagIds.map((tagId) => ({ tagId })) } },
    });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PROJECT, entityId: p.id, action: "CREATE", after: await snapshot(tx, p.id), ip });
    return p;
  }, TX);
}

/** แก้ไขโครงการ — ถ้าสถานะเปลี่ยน เก็บเป็น "เปลี่ยนสถานะ" ในการเคลื่อนไหว */
export async function updateProject(actor: CurrentUser, id: string, d: ProjectData, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM projects WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!row) throw new ApiError(404, "ไม่พบโครงการ");
    const current = await tx.project.findUniqueOrThrow({ where: { id }, include: projectInclude });
    await assertRefs(tx, d, current);
    const before = await snapshot(tx, id);
    await tx.projectTag.deleteMany({ where: { projectId: id } });
    await tx.project.update({ where: { id }, data: { ...data(d), updatedById: actor.id, tags: { create: d.tagIds.map((tagId) => ({ tagId })) } } });
    const statusChanged = current.status !== d.status;
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_PROJECT,
      entityId: id,
      action: statusChanged ? "STATUS_CHANGE" : "UPDATE",
      before,
      after: await snapshot(tx, id),
      note: statusChanged ? `เปลี่ยนสถานะ: ${PROJECT_STATUS_LABELS[current.status]} → ${PROJECT_STATUS_LABELS[d.status]}` : null,
      ip,
    });
  }, TX);
}

/** ลบโครงการ (soft delete) — ลบไม่ได้ถ้ามีใบถอดแบบที่ยังไม่ยกเลิก หรือแผนการทำงานอ้างอิง */
export async function deleteProject(actor: CurrentUser, id: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const p = await tx.project.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new ApiError(404, "ไม่พบโครงการ");
    const [docs, plans] = await Promise.all([
      tx.engineerDoc.count({ where: { projectId: id, status: { not: "CANCELLED" } } }),
      tx.workPlan.count({ where: { projectId: id, status: { not: "CANCELLED" } } }),
    ]);
    if (docs || plans) throw new ApiError(409, "ลบไม่ได้ เพราะมีใบถอดแบบ/ติดตั้ง หรือแผนการทำงานอ้างอิงโครงการนี้อยู่");
    const before = await snapshot(tx, id);
    await tx.project.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actor.id } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PROJECT, entityId: id, action: "DELETE", before, ip });
  }, TX);
}

export async function getProject(id: string) {
  const p = await prisma.project.findFirst({ where: { id, deletedAt: null }, include: projectInclude });
  if (!p) return null;
  const [engineerDocs, plans] = await Promise.all([
    prisma.engineerDoc.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, select: { id: true, docNo: true, status: true, docDate: true } }),
    prisma.workPlan.findMany({
      where: { projectId: id },
      orderBy: { plannedStart: "desc" },
      take: 50,
      select: { id: true, subject: true, status: true, plannedStart: true, employee: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  return { project: p, engineerDocs, plans };
}

/** ตัวเลือกของฟอร์มโครงการ */
export async function getProjectFormOptions() {
  const [users, lookups, tags] = await Promise.all([
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, department: true, status: true }, orderBy: [{ status: "asc" }, { firstName: "asc" }] }),
    prisma.lookupOption.findMany({
      where: { kind: { in: ["CUSTOMER_BUSINESS_TYPE", "PROJECT_WORK_STAGE", "PROJECT_WORK_NATURE"] } },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);
  const pick = (kind: string) => lookups.filter((l) => l.kind === kind).map((l) => ({ id: l.id, label: l.label, isActive: l.isActive }));
  return {
    users: users.map((u) => ({ id: u.id, name: fullName(u), department: u.department, inactive: u.status !== "ACTIVE" })),
    businessTypes: pick("CUSTOMER_BUSINESS_TYPE"),
    workStages: pick("PROJECT_WORK_STAGE"),
    workNatures: pick("PROJECT_WORK_NATURE"),
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
  };
}
export type ProjectFormOptions = Awaited<ReturnType<typeof getProjectFormOptions>>;

/** ค้นหาโครงการสำหรับเลือกในเอกสารอื่น (แผนการทำงาน / ใบถอดแบบ) */
export async function searchProjectOptions(q: string, customerId?: string | null) {
  const contains = { contains: q, mode: "insensitive" as const };
  const rows = await prisma.project.findMany({
    where: { deletedAt: null, ...(customerId ? { customerId } : {}), ...(q ? { OR: [{ name: contains }, { customer: { name: contains } }] } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, name: true, customer: { select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } } },
  });
  return rows;
}
export type ProjectOption = Awaited<ReturnType<typeof searchProjectOptions>>[number];
