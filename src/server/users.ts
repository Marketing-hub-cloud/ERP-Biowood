import "server-only";
import bcrypt from "bcryptjs";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import type { CurrentUser } from "@/lib/session";
import type { z } from "zod";
import type { userCreateSchema, userStatusSchema, userUpdateSchema } from "@/lib/validators";

export const BCRYPT_ROUNDS = 10;
export const ENTITY_USER = "User";

const snapshotSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  department: true,
  position: true,
  isAdmin: true,
  status: true,
  statusNote: true,
  groups: { select: { group: { select: { id: true, name: true } } } },
} as const;

async function snapshot(tx: TxClient, id: string) {
  const u = await tx.user.findUnique({ where: { id }, select: snapshotSelect });
  if (!u) return null;
  const { groups, ...rest } = u;
  return { ...rest, groups: groups.map((g) => g.group.name).sort() };
}

async function assertGroupsExist(tx: TxClient, ids: string[]) {
  if (!ids.length) return;
  const n = await tx.permissionGroup.count({ where: { id: { in: ids } } });
  if (n !== new Set(ids).size) throw new ApiError(400, "ไม่พบกลุ่มสิทธิ์บางกลุ่ม");
}

async function countOtherActiveAdmins(tx: TxClient, excludeId: string) {
  return tx.user.count({ where: { isAdmin: true, status: "ACTIVE", id: { not: excludeId } } });
}

export async function createUser(actor: CurrentUser, input: z.output<typeof userCreateSchema>, ip: string | null) {
  if (input.isAdmin && !actor.isAdmin) throw new ApiError(403, "เฉพาะผู้ดูแลระบบเท่านั้นที่กำหนดสิทธิ์ผู้ดูแลระบบได้");
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw new ApiError(409, "อีเมลนี้ถูกใช้แล้ว", { email: "อีเมลนี้ถูกใช้แล้ว" });
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const groupIds = [...new Set(input.groupIds ?? [])];

  return prisma.$transaction(async (tx) => {
    await assertGroupsExist(tx, groupIds);
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        department: input.department,
        position: input.position,
        isAdmin: Boolean(input.isAdmin),
        createdById: actor.id,
        groups: { create: groupIds.map((groupId) => ({ groupId })) },
      },
    });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_USER, entityId: user.id, action: "CREATE", after: await snapshot(tx, user.id), ip });
    return user;
  });
}

export async function updateUser(actor: CurrentUser, id: string, input: z.output<typeof userUpdateSchema>, ip: string | null) {
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, "ไม่พบผู้ใช้");
  if (current.isAdmin && !actor.isAdmin) throw new ApiError(403, "เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขบัญชีผู้ดูแลระบบได้");
  const wantAdmin = input.isAdmin ?? current.isAdmin;
  if (wantAdmin !== current.isAdmin) {
    if (!actor.isAdmin) throw new ApiError(403, "เฉพาะผู้ดูแลระบบเท่านั้นที่กำหนดสิทธิ์ผู้ดูแลระบบได้");
    if (!wantAdmin && (await countOtherActiveAdmins(prisma, id)) === 0) {
      throw new ApiError(400, "ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน");
    }
  }
  if (input.email !== current.email) {
    const dup = await prisma.user.findUnique({ where: { email: input.email } });
    if (dup) throw new ApiError(409, "อีเมลนี้ถูกใช้แล้ว", { email: "อีเมลนี้ถูกใช้แล้ว" });
  }
  const passwordHash = input.password ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : undefined;

  return prisma.$transaction(async (tx) => {
    const before = await snapshot(tx, id);
    if (input.groupIds) {
      const groupIds = [...new Set(input.groupIds)];
      await assertGroupsExist(tx, groupIds);
      await tx.userGroup.deleteMany({ where: { userId: id } });
      if (groupIds.length) await tx.userGroup.createMany({ data: groupIds.map((groupId) => ({ userId: id, groupId })) });
    }
    const user = await tx.user.update({
      where: { id },
      data: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        department: input.department,
        position: input.position,
        isAdmin: wantAdmin,
        ...(passwordHash ? { passwordHash } : {}),
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_USER,
      entityId: id,
      action: "UPDATE",
      before,
      after: await snapshot(tx, id),
      note: passwordHash ? "เปลี่ยนรหัสผ่าน" : null,
      force: Boolean(passwordHash),
      ip,
    });
    return user;
  });
}

export async function setUserStatus(actor: CurrentUser, id: string, input: z.output<typeof userStatusSchema>, ip: string | null) {
  const current = await prisma.user.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, "ไม่พบผู้ใช้");
  if (current.isAdmin && !actor.isAdmin) throw new ApiError(403, "เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนสถานะบัญชีผู้ดูแลระบบได้");
  if (input.status === "INACTIVE") {
    if (id === actor.id) throw new ApiError(400, "ไม่สามารถหยุดใช้งานบัญชีของตัวเองได้");
    if (current.isAdmin && (await countOtherActiveAdmins(prisma, id)) === 0) {
      throw new ApiError(400, "ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน");
    }
  }
  return prisma.$transaction(async (tx) => {
    const before = await snapshot(tx, id);
    const user = await tx.user.update({ where: { id }, data: { status: input.status, statusNote: input.statusNote } });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_USER,
      entityId: id,
      action: "STATUS_CHANGE",
      before,
      after: await snapshot(tx, id),
      note: input.statusNote,
      ip,
    });
    return user;
  });
}

export async function updateProfile(
  actor: CurrentUser,
  data: { firstName: string; lastName: string; department: string | null; position: string | null },
  ip: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const before = await snapshot(tx, actor.id);
    await tx.user.update({ where: { id: actor.id }, data });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_USER, entityId: actor.id, action: "UPDATE", before, after: await snapshot(tx, actor.id), note: "แก้ไขข้อมูลส่วนตัว", ip });
  });
}

export async function changeOwnPassword(actor: CurrentUser, currentPassword: string, newPassword: string, ip: string | null) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ApiError(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง", { currentPassword: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { passwordHash } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_USER, entityId: actor.id, action: "UPDATE", note: "เปลี่ยนรหัสผ่านของตัวเอง", force: true, ip });
  });
}
