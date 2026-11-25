import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { allocateDocNumber, DOC_PREFIXES } from "@/lib/doc-number";
import { formatDate, formatNumber, fullName } from "@/lib/format";
import { dateOnly } from "@/lib/stock-rules";
import {
  canManageFile,
  checkAdvance,
  ENGINEER_STATUS_LABELS,
  FILE_KIND_LABELS,
  fileKindOpen,
  isEditableStatus,
  MAX_ENGINEER_FILES,
  URGENCY_LABELS,
  WORK_TYPE_LABELS,
  type EngineerFileKind,
  type EngineerStatus,
} from "@/lib/engineer-workflow";
import { enqueueEngineerEvent } from "@/lib/notifications";
import { kickNotificationWorker } from "@/lib/notification-worker";
import type { EngineerDocData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";
import { assertProducts, PURCHASE_TX } from "./purchase-common";

export const ENTITY_EN = "EngineerDoc";
const TX = PURCHASE_TX;

const userSel = { select: { id: true, firstName: true, lastName: true, avatarKey: true } } as const;

export const engineerInclude = {
  customer: { select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } },
  project: { select: { id: true, name: true, customer: { select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } } } },
  assignee: userSel,
  createdBy: userSel,
  cancelledBy: userSel,
  participants: { include: { user: userSel }, orderBy: { user: { firstName: "asc" } } },
  files: { orderBy: { createdAt: "asc" }, include: { uploadedBy: userSel } },
  estimateLines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } },
} satisfies Prisma.EngineerDocInclude;
export type EngineerFull = Prisma.EngineerDocGetPayload<{ include: typeof engineerInclude }>;

async function snapshot(tx: TxClient, id: string) {
  const d = await tx.engineerDoc.findUniqueOrThrow({ where: { id }, include: engineerInclude });
  return {
    docDate: formatDate(d.docDate),
    startDate: d.startDate ? formatDate(d.startDate) : null,
    dueDate: d.dueDate ? formatDate(d.dueDate) : null,
    revision: d.revision,
    workTypes: d.workTypes.map((w) => WORK_TYPE_LABELS[w]),
    workDetail: d.workDetail,
    projectName: d.projectName,
    project: d.project?.name ?? null,
    urgency: URGENCY_LABELS[d.urgency],
    customer: d.customer ? `${d.customer.code} ${d.customer.name}` : null,
    siteAddress: d.siteAddress,
    assignee: d.assignee ? fullName(d.assignee) : null,
    participants: d.participants.map((p) => fullName(p.user)),
    note: d.note,
    status: ENGINEER_STATUS_LABELS[d.status],
    estimateLines: d.estimateLines.map((l) => `${l.product.code} ${l.product.name} × ${formatNumber(l.quantity.toString())} ${l.product.stockUnit?.name ?? ""}`.trim()),
    files: d.files.map((f) => `${FILE_KIND_LABELS[f.kind]}: ${f.fileName}`),
  };
}

/** lock แถวเอกสาร (กันแก้/เปลี่ยนขั้นพร้อมกัน) */
async function lockDoc(tx: TxClient, id: string) {
  const [row] = await tx.$queryRaw<{ status: EngineerStatus; docNo: string; projectName: string; assigneeId: string | null }[]>`
    SELECT status::text AS status, "docNo", "projectName", "assigneeId" FROM engineer_docs WHERE id = ${id} FOR UPDATE`;
  if (!row) throw new ApiError(404, "ไม่พบใบถอดแบบ/ติดตั้ง");
  return row;
}

async function assertRefs(tx: TxClient, d: EngineerDocData, current?: EngineerFull) {
  if (d.customerId && d.customerId !== current?.customerId) {
    const c = await tx.contact.findFirst({ where: { id: d.customerId, deletedAt: null } });
    if (!c) throw new ApiError(400, "ไม่พบลูกค้า", { customerId: "ไม่พบลูกค้า" });
    if (!c.isCustomer) throw new ApiError(400, "ผู้ติดต่อนี้ไม่ได้เป็นลูกค้า", { customerId: "ผู้ติดต่อนี้ไม่ได้เป็นลูกค้า" });
  }
  if (d.projectId && d.projectId !== current?.projectId) {
    const p = await tx.project.findFirst({ where: { id: d.projectId, deletedAt: null } });
    if (!p) throw new ApiError(400, "ไม่พบโครงการ", { projectId: "ไม่พบโครงการ" });
  }
  const keepUsers = new Set([current?.assigneeId, ...(current?.participants.map((p) => p.userId) ?? [])].filter(Boolean) as string[]);
  const userIds = [...new Set([d.assigneeId, ...d.participantIds].filter(Boolean) as string[])];
  if (userIds.length) {
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, status: true } });
    const ok = (id: string) => users.some((u) => u.id === id && (u.status === "ACTIVE" || keepUsers.has(id)));
    if (d.assigneeId && !ok(d.assigneeId)) throw new ApiError(400, "ไม่พบผู้รับผิดชอบงาน", { assigneeId: "ไม่พบผู้ใช้ หรือถูกหยุดใช้งาน" });
    if (d.participantIds.some((id) => !ok(id))) throw new ApiError(400, "ไม่พบผู้เกี่ยวข้องบางคน", { participantIds: "ไม่พบผู้ใช้ หรือถูกหยุดใช้งาน" });
  }
  if (d.estimateLines.length) {
    const fields: Record<string, string> = {};
    try {
      await assertProducts(tx, d.estimateLines.map((l) => l.productId), new Set(current?.estimateLines.map((l) => l.productId)));
    } catch (e) {
      // แปลงชื่อฟิลด์ lines.N → estimateLines.N
      if (e instanceof ApiError && e.fields) {
        for (const [k, v] of Object.entries(e.fields)) fields[k.replace(/^lines\./, "estimateLines.")] = v;
        throw new ApiError(400, e.message, fields);
      }
      throw e;
    }
  }
}

const header = (d: EngineerDocData) => ({
  docDate: dateOnly(d.docDate),
  startDate: d.startDate ? dateOnly(d.startDate) : null,
  dueDate: d.dueDate ? dateOnly(d.dueDate) : null,
  revision: d.revision,
  workTypes: d.workTypes,
  workDetail: d.workDetail,
  projectName: d.projectName,
  projectId: d.projectId,
  urgency: d.urgency,
  customerId: d.customerId,
  addressLabel: d.customerId ? d.addressLabel : null,
  siteAddress: d.siteAddress,
  assigneeId: d.assigneeId,
  note: d.note,
});
const estimateRows = (d: EngineerDocData) => d.estimateLines.map((l, i) => ({ lineNo: i + 1, productId: l.productId, quantity: l.quantity, note: l.note }));
const participantRows = (d: EngineerDocData) => d.participantIds.map((userId) => ({ userId }));

export async function createEngineerDoc(actor: CurrentUser, d: EngineerDocData, ip: string | null) {
  const doc = await prisma.$transaction(async (tx) => {
    await assertRefs(tx, d);
    const docNo = await allocateDocNumber(tx, DOC_PREFIXES.ENGINEER);
    const r = await tx.engineerDoc.create({
      data: {
        ...header(d),
        docNo,
        createdById: actor.id,
        participants: { create: participantRows(d) },
        estimateLines: { create: estimateRows(d) },
        stepLogs: { create: { fromStatus: null, toStatus: "DRAFT", actorId: actor.id } },
      },
    });
    await enqueueEngineerEvent(tx, { kind: "created", docId: r.id, docNo, projectName: r.projectName, status: "DRAFT", actorId: actor.id, actorName: fullName(actor) });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_EN, entityId: r.id, action: "CREATE", after: await snapshot(tx, r.id), ip });
    return r;
  }, TX);
  kickNotificationWorker();
  return doc;
}

export async function updateEngineerDoc(actor: CurrentUser, id: string, d: EngineerDocData, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const row = await lockDoc(tx, id);
    if (!isEditableStatus(row.status)) throw new ApiError(409, `เอกสารที่${ENGINEER_STATUS_LABELS[row.status]}แล้ว แก้ไขไม่ได้`);
    const current = await tx.engineerDoc.findUniqueOrThrow({ where: { id }, include: engineerInclude });
    // หลังมอบหมายแล้ว ต้องมีผู้รับผิดชอบเสมอ
    if (!d.assigneeId && current.assigneeId && ["ASSIGNED", "IN_PROGRESS", "INSPECTION", "ESTIMATE"].includes(row.status)) {
      throw new ApiError(400, "เอกสารที่มอบหมายแล้วต้องมีผู้รับผิดชอบงาน", { assigneeId: "กรุณาเลือกผู้รับผิดชอบงาน" });
    }
    if (!d.customerId && row.status !== "DRAFT") throw new ApiError(400, "กรุณาเลือกลูกค้า", { customerId: "กรุณาเลือกลูกค้า" });
    await assertRefs(tx, d, current);
    const before = await snapshot(tx, id);
    await tx.engineerParticipant.deleteMany({ where: { docId: id } });
    await tx.engineerEstimateLine.deleteMany({ where: { docId: id } });
    await tx.engineerDoc.update({
      where: { id },
      data: { ...header(d), updatedById: actor.id, participants: { create: participantRows(d) }, estimateLines: { create: estimateRows(d) } },
    });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_EN, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
  }, TX);
}

/** ไปขั้นถัดไปตาม state machine (from = ขั้นที่ผู้ใช้เห็นตอนกด) */
export async function advanceEngineerDoc(actor: CurrentUser, id: string, from: EngineerStatus, comment: string | null, ip: string | null) {
  const res = await prisma.$transaction(async (tx) => {
    const row = await lockDoc(tx, id);
    // ทีละ query: transaction เดียวใช้ connection เดียว ยิงขนานไม่ได้เร็วขึ้น
    const info = await tx.engineerDoc.findUniqueOrThrow({ where: { id }, select: { workTypes: true, customerId: true } });
    const returnDocCount = await tx.engineerFile.count({ where: { docId: id, kind: "RETURN_DOC" } });
    const estimateLineCount = await tx.engineerEstimateLine.count({ where: { docId: id } });
    const check = checkAdvance(row.status, from, actor.permissions, actor.id, {
      customerId: info.customerId,
      assigneeId: row.assigneeId,
      workTypes: info.workTypes,
      returnDocCount,
      estimateLineCount,
    });
    if (!check.ok) throw new ApiError(check.status, check.error);
    const t = check.transition;
    const before = await snapshot(tx, id);
    await tx.engineerDoc.update({
      where: { id },
      data: { status: t.to, updatedById: actor.id, ...(t.to === "COMPLETED" ? { completedAt: new Date() } : {}) },
    });
    await tx.engineerStepLog.create({ data: { docId: id, fromStatus: row.status, toStatus: t.to, actorId: actor.id, comment } });
    await enqueueEngineerEvent(tx, {
      kind: "advanced",
      docId: id,
      docNo: row.docNo,
      projectName: row.projectName,
      status: t.to,
      fromStatus: row.status,
      actorId: actor.id,
      actorName: fullName(actor),
      comment,
    });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_EN,
      entityId: id,
      action: t.perm === "approve" ? "APPROVE" : "STATUS_CHANGE",
      before,
      after: await snapshot(tx, id),
      note: `${t.label}: ${ENGINEER_STATUS_LABELS[row.status]} → ${ENGINEER_STATUS_LABELS[t.to]}${comment ? ` · ${comment}` : ""}`,
      force: true,
      ip,
    });
    return { status: t.to, docNo: row.docNo };
  }, TX);
  kickNotificationWorker();
  return res;
}

export async function cancelEngineerDoc(actor: CurrentUser, id: string, reason: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const row = await lockDoc(tx, id);
    if (row.status === "CANCELLED") throw new ApiError(409, "เอกสารนี้ถูกยกเลิกแล้ว");
    if (row.status === "COMPLETED") throw new ApiError(409, "เอกสารที่เสร็จสิ้นแล้วยกเลิกไม่ได้");
    const before = await snapshot(tx, id);
    await tx.engineerDoc.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason, updatedById: actor.id },
    });
    await tx.engineerStepLog.create({ data: { docId: id, fromStatus: row.status, toStatus: "CANCELLED", actorId: actor.id, comment: reason } });
    await enqueueEngineerEvent(tx, {
      kind: "cancelled",
      docId: id,
      docNo: row.docNo,
      projectName: row.projectName,
      status: "CANCELLED",
      fromStatus: row.status,
      actorId: actor.id,
      actorName: fullName(actor),
      comment: reason,
    });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_EN, entityId: id, action: "CANCEL", before, after: await snapshot(tx, id), note: `ยกเลิก: ${reason}`, ip });
  }, TX);
  kickNotificationWorker();
}

// ───────────── ไฟล์แนบ ─────────────

/** ตรวจสิทธิ์/ขั้นก่อนอัปโหลด (เรียกก่อนเขียนไฟล์ลง storage จะได้ไม่ทิ้งไฟล์ค้าง) */
export async function assertCanAttach(actor: CurrentUser, id: string, kind: EngineerFileKind) {
  const d = await prisma.engineerDoc.findUnique({ where: { id }, select: { status: true, assigneeId: true } });
  if (!d) throw new ApiError(404, "ไม่พบใบถอดแบบ/ติดตั้ง");
  checkFileRules(actor, kind, d.status, d.assigneeId);
}

function checkFileRules(actor: CurrentUser, kind: EngineerFileKind, status: EngineerStatus, assigneeId: string | null) {
  if (!canManageFile(kind, actor.permissions, actor.id, assigneeId)) throw new ApiError(403, `ไม่มีสิทธิ์จัดการไฟล์${FILE_KIND_LABELS[kind]}`);
  if (!fileKindOpen(kind, status)) {
    throw new ApiError(
      409,
      kind === "RETURN_DOC" && isEditableStatus(status)
        ? "แนบเอกสารส่งกลับได้ตั้งแต่ขั้นมอบหมาย"
        : `เอกสารสถานะ "${ENGINEER_STATUS_LABELS[status]}" แนบ/ลบไฟล์ไม่ได้`,
    );
  }
}

export async function addEngineerFile(
  actor: CurrentUser,
  id: string,
  f: { kind: EngineerFileKind; key: string; fileName: string; contentType: string; size: number },
  ip: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const row = await lockDoc(tx, id);
    checkFileRules(actor, f.kind, row.status, row.assigneeId);
    if ((await tx.engineerFile.count({ where: { docId: id } })) >= MAX_ENGINEER_FILES) {
      throw new ApiError(400, `แนบไฟล์ได้ไม่เกิน ${MAX_ENGINEER_FILES} ไฟล์ต่อเอกสาร`);
    }
    const file = await tx.engineerFile.create({ data: { docId: id, ...f, uploadedById: actor.id } });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_EN,
      entityId: id,
      action: "UPDATE",
      note: `แนบไฟล์${FILE_KIND_LABELS[f.kind]}: ${f.fileName}`,
      force: true,
      ip,
    });
    return file;
  }, TX);
}

/** ลบไฟล์แนบ — คืน storage key ให้ลบไฟล์จริงหลัง commit */
export async function removeEngineerFile(actor: CurrentUser, id: string, fileId: string, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const row = await lockDoc(tx, id);
    const file = await tx.engineerFile.findFirst({ where: { id: fileId, docId: id } });
    if (!file) throw new ApiError(404, "ไม่พบไฟล์");
    checkFileRules(actor, file.kind, row.status, row.assigneeId);
    await tx.engineerFile.delete({ where: { id: fileId } });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_EN,
      entityId: id,
      action: "UPDATE",
      note: `ลบไฟล์${FILE_KIND_LABELS[file.kind]}: ${file.fileName}`,
      force: true,
      ip,
    });
    return file.key;
  }, TX);
}

// ───────────── อ่านข้อมูล ─────────────

export async function getEngineerDetail(id: string) {
  const doc = await prisma.engineerDoc.findUnique({ where: { id }, include: engineerInclude });
  if (!doc) return null;
  const steps = await prisma.engineerStepLog.findMany({ where: { docId: id }, orderBy: { createdAt: "asc" }, include: { actor: userSel } });
  return { doc, steps };
}
export type EngineerStepEntry = NonNullable<Awaited<ReturnType<typeof getEngineerDetail>>>["steps"][number];

/** ตัวเลือกของฟอร์ม: ผู้ใช้ (ผู้เกี่ยวข้อง/ผู้รับผิดชอบ) และสินค้า (ใบสรุปประมาณ) */
export async function getEngineerFormOptions() {
  const [users, products] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, department: true, avatarKey: true, status: true },
      orderBy: [{ status: "asc" }, { firstName: "asc" }],
    }),
    prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, isActive: true, stockUnit: { select: { name: true } } },
    }),
  ]);
  return {
    users: users.map((u) => ({
      id: u.id,
      name: fullName(u),
      department: u.department,
      avatarUrl: u.avatarKey ? `/api/files/${u.avatarKey}` : null,
      inactive: u.status !== "ACTIVE",
    })),
    products: products.map((p) => ({ id: p.id, code: p.code, name: p.name, isActive: p.isActive, unit: p.stockUnit?.name ?? "" })),
  };
}
export type EngineerFormOptions = Awaited<ReturnType<typeof getEngineerFormOptions>>;
