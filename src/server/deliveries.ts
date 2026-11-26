import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { bangkokLocalToDate } from "@/lib/date-input";
import { can } from "@/lib/rbac";
import { checkDeliveryAction, DELIVERY_ACTION_LABELS, DELIVERY_MENU, DELIVERY_STATUS_LABELS, type DeliveryAction, type DeliveryStatus } from "@/lib/delivery";
import { ISSUE_STATUS_LABELS, ISSUE_TYPE_LABELS } from "@/lib/stock-rules";
import type { DeliveryJobData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const ENTITY_DELIVERY = "DeliveryJob";
const TX = { maxWait: 10_000, timeout: 30_000 } as const;

export const deliveryInclude = {
  driver: { select: { id: true, firstName: true, lastName: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  goodsIssue: {
    select: {
      id: true,
      docNo: true,
      type: true,
      status: true,
      docDate: true,
      recipientName: true,
      shippingAddress: true,
      contact: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.DeliveryJobInclude;
export type DeliveryFull = Prisma.DeliveryJobGetPayload<{ include: typeof deliveryInclude }>;

async function snapshot(tx: TxClient, id: string) {
  const d = await tx.deliveryJob.findUniqueOrThrow({ where: { id }, include: deliveryInclude });
  return {
    goodsIssue: d.goodsIssue.docNo,
    status: DELIVERY_STATUS_LABELS[d.status],
    startAt: formatDateTime(d.startAt),
    endAt: formatDateTime(d.endAt),
    driver: fullName(d.driver),
    mapUrl: d.mapUrl,
    shippingAddress: d.shippingAddress,
    note: d.note,
  };
}

async function assertRefs(tx: TxClient, d: DeliveryJobData, current?: { goodsIssueId: string; driverId: string }) {
  if (d.goodsIssueId !== current?.goodsIssueId) {
    const gi = await tx.goodsIssue.findUnique({ where: { id: d.goodsIssueId }, select: { status: true } });
    if (!gi) throw new ApiError(400, "ไม่พบใบนำออก", { goodsIssueId: "ไม่พบใบนำออก" });
    if (gi.status === "CANCELLED") throw new ApiError(400, "ใบนำออกถูกยกเลิกแล้ว", { goodsIssueId: "ใบนำออกถูกยกเลิกแล้ว" });
  }
  if (d.driverId !== current?.driverId) {
    const u = await tx.user.findUnique({ where: { id: d.driverId }, select: { status: true } });
    if (!u || u.status !== "ACTIVE") throw new ApiError(400, "ไม่พบพนักงานจัดส่ง", { driverId: "ไม่พบผู้ใช้ หรือถูกหยุดใช้งาน" });
  }
}

const data = (d: DeliveryJobData) => ({
  goodsIssueId: d.goodsIssueId,
  startAt: bangkokLocalToDate(d.startAt)!,
  endAt: bangkokLocalToDate(d.endAt)!,
  driverId: d.driverId,
  mapUrl: d.mapUrl,
  shippingAddress: d.shippingAddress,
  note: d.note,
});

export async function createDelivery(actor: CurrentUser, d: DeliveryJobData, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    // lock ใบนำออก กันยกเลิกใบนำออกพร้อมกับสร้างงาน
    await tx.$queryRaw`SELECT id FROM goods_issues WHERE id = ${d.goodsIssueId} FOR UPDATE`;
    await assertRefs(tx, d);
    const j = await tx.deliveryJob.create({ data: { ...data(d), createdById: actor.id } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_DELIVERY, entityId: j.id, action: "CREATE", after: await snapshot(tx, j.id), ip });
    return j;
  }, TX);
}

async function lockJob(tx: TxClient, id: string) {
  const [row] = await tx.$queryRaw<{ status: DeliveryStatus; driverId: string; goodsIssueId: string }[]>`
    SELECT status::text AS status, "driverId", "goodsIssueId" FROM delivery_jobs WHERE id = ${id} FOR UPDATE`;
  if (!row) throw new ApiError(404, "ไม่พบงานจัดส่ง");
  return row;
}

/** แก้ไขรายละเอียด (สิทธิ์แก้ไข) เฉพาะงานที่ยังนัดส่งอยู่ */
export async function updateDelivery(actor: CurrentUser, id: string, d: DeliveryJobData, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const row = await lockJob(tx, id);
    if (row.status !== "SCHEDULED") throw new ApiError(409, `งานจัดส่งที่${DELIVERY_STATUS_LABELS[row.status]}แล้ว แก้ไขไม่ได้`);
    await assertRefs(tx, d, row);
    const before = await snapshot(tx, id);
    await tx.deliveryJob.update({ where: { id }, data: { ...data(d), updatedById: actor.id } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_DELIVERY, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
  }, TX);
}

export async function runDeliveryAction(actor: CurrentUser, id: string, action: DeliveryAction, reason: string | null | undefined, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const row = await lockJob(tx, id);
    const check = checkDeliveryAction(action, row.status, actor.permissions, actor.id, row.driverId);
    if (!check.ok) throw new ApiError(check.status, check.error);
    const now = new Date();
    const before = await snapshot(tx, id);
    const r = reason?.trim() || null;
    await tx.deliveryJob.update({
      where: { id },
      data:
        action === "deliver"
          ? { status: check.to, deliveredAt: now, updatedById: actor.id }
          : { status: check.to, cancelledAt: now, cancelReason: r, updatedById: actor.id },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_DELIVERY,
      entityId: id,
      action: action === "cancel" ? "CANCEL" : "STATUS_CHANGE",
      before,
      after: await snapshot(tx, id),
      note: `${DELIVERY_ACTION_LABELS[action]}${r ? `: ${r}` : ""}`,
      force: true,
      ip,
    });
    return { status: check.to };
  }, TX);
}

/** ยกเลิกใบนำออกแล้ว: ยกเลิกงานจัดส่งที่ยังนัดส่งอยู่ด้วย (เรียกใน transaction เดียวกับการยกเลิกใบนำออก) */
export async function cancelDeliveriesOfIssue(tx: TxClient, goodsIssueId: string, docNo: string, actorId: string, ip: string | null) {
  const jobs = await tx.deliveryJob.findMany({ where: { goodsIssueId, status: "SCHEDULED" }, select: { id: true } });
  for (const j of jobs) {
    const before = await snapshot(tx, j.id);
    // where มี status กันทับงานที่เพิ่งกด "ส่งแล้ว" พร้อมกัน
    const res = await tx.deliveryJob.updateMany({
      where: { id: j.id, status: "SCHEDULED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `ยกเลิกใบนำออก ${docNo}`, updatedById: actorId },
    });
    if (!res.count) continue;
    await writeAudit(tx, { actorId, entityType: ENTITY_DELIVERY, entityId: j.id, action: "CANCEL", before, after: await snapshot(tx, j.id), note: `ยกเลิกตามใบนำออก ${docNo}`, force: true, ip });
  }
}

export async function getDelivery(id: string) {
  return prisma.deliveryJob.findUnique({ where: { id }, include: deliveryInclude });
}

export type IssueOption = { id: string; docNo: string; label: string; contact: string | null; recipientName: string | null; shippingAddress: string | null };

const issueOption = (g: DeliveryFull["goodsIssue"]): IssueOption => ({
  id: g.id,
  docNo: g.docNo,
  label: `${g.docNo} · ${ISSUE_TYPE_LABELS[g.type]} · ${formatDate(g.docDate)}${g.status === "DRAFT" ? ` (${ISSUE_STATUS_LABELS.DRAFT})` : ""}${g.contact ? ` · ${g.contact.name}` : ""}`,
  contact: g.contact?.name ?? null,
  recipientName: g.recipientName,
  shippingAddress: g.shippingAddress,
});

/** ตัวเลือกในฟอร์ม: พนักงาน + ใบนำออกที่ยังไม่ยกเลิก (ล่าสุด 300 ใบ + ใบที่ระบุ) */
export async function getDeliveryFormOptions(includeIssueId?: string | null) {
  const select = deliveryInclude.goodsIssue.select;
  const [users, issues, extra] = await Promise.all([
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, department: true, status: true }, orderBy: [{ status: "asc" }, { firstName: "asc" }] }),
    prisma.goodsIssue.findMany({ where: { status: { not: "CANCELLED" } }, select, orderBy: [{ docDate: "desc" }, { docNo: "desc" }], take: 300 }),
    includeIssueId ? prisma.goodsIssue.findUnique({ where: { id: includeIssueId }, select }) : Promise.resolve(null),
  ]);
  const list = extra && !issues.some((i) => i.id === extra.id) ? [extra, ...issues] : issues;
  return {
    users: users.map((u) => ({ id: u.id, name: fullName(u), department: u.department, inactive: u.status !== "ACTIVE" })),
    issues: list.map(issueOption),
  };
}
export type DeliveryFormOptions = Awaited<ReturnType<typeof getDeliveryFormOptions>>;

/** งานจัดส่งของใบนำออก (แสดงในหน้าใบนำออก) */
export async function deliveriesOfIssue(goodsIssueId: string) {
  return prisma.deliveryJob.findMany({ where: { goodsIssueId }, include: { driver: { select: { firstName: true, lastName: true } } }, orderBy: { startAt: "asc" } });
}

export const canEditDelivery = (u: CurrentUser) => can(u.permissions, DELIVERY_MENU, "edit");
