import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { flagsToRow, rowToFlags } from "@/lib/rbac";
import { PERMISSION_ACTIONS } from "@/lib/menu";
import type { CurrentUser } from "@/lib/session";
import type { z } from "zod";
import type { groupSchema } from "@/lib/validators";

export const ENTITY_GROUP = "PermissionGroup";

type GroupData = z.output<typeof groupSchema>;

/** snapshot สำหรับ audit: สิทธิ์เป็น "menuKey: view,create" อ่านง่าย */
async function snapshot(tx: TxClient, id: string) {
  const g = await tx.permissionGroup.findUnique({
    where: { id },
    include: { permissions: true, members: { include: { user: { select: { email: true } } } } },
  });
  if (!g) return null;
  const permissions: Record<string, string> = {};
  for (const p of g.permissions.sort((a, b) => a.menuKey.localeCompare(b.menuKey))) {
    const f = rowToFlags(p);
    const on = PERMISSION_ACTIONS.filter((a) => f[a]);
    if (on.length) permissions[p.menuKey] = on.join(",");
  }
  return {
    name: g.name,
    description: g.description,
    permissions,
    members: g.members.map((m) => m.user.email).sort(),
  };
}

async function writeChildren(tx: TxClient, groupId: string, data: GroupData) {
  await tx.groupPermission.deleteMany({ where: { groupId } });
  const rows = Object.entries(data.permissions)
    .map(([menuKey, f]) => flagsToRow(menuKey, f))
    .filter((r) => r.canView);
  if (rows.length) await tx.groupPermission.createMany({ data: rows.map((r) => ({ ...r, groupId })) });

  await tx.userGroup.deleteMany({ where: { groupId } });
  const memberIds = [...new Set(data.memberIds)];
  if (memberIds.length) {
    const n = await tx.user.count({ where: { id: { in: memberIds } } });
    if (n !== memberIds.length) throw new ApiError(400, "ไม่พบผู้ใช้บางคน");
    await tx.userGroup.createMany({ data: memberIds.map((userId) => ({ userId, groupId })) });
  }
}

async function assertNameFree(name: string, exceptId?: string) {
  const dup = await prisma.permissionGroup.findUnique({ where: { name } });
  if (dup && dup.id !== exceptId) throw new ApiError(409, "ชื่อกลุ่มสิทธิ์นี้มีอยู่แล้ว", { name: "ชื่อกลุ่มสิทธิ์นี้มีอยู่แล้ว" });
}

export async function createGroup(actor: CurrentUser, data: GroupData, ip: string | null) {
  await assertNameFree(data.name);
  return prisma.$transaction(async (tx) => {
    const g = await tx.permissionGroup.create({ data: { name: data.name, description: data.description } });
    await writeChildren(tx, g.id, data);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_GROUP, entityId: g.id, action: "CREATE", after: await snapshot(tx, g.id), ip });
    return g;
  });
}

export async function updateGroup(actor: CurrentUser, id: string, data: GroupData, ip: string | null) {
  await assertNameFree(data.name, id);
  return prisma.$transaction(async (tx) => {
    const before = await snapshot(tx, id);
    if (!before) throw new ApiError(404, "ไม่พบกลุ่มสิทธิ์");
    const g = await tx.permissionGroup.update({ where: { id }, data: { name: data.name, description: data.description } });
    await writeChildren(tx, id, data);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_GROUP, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
    return g;
  });
}

export async function deleteGroup(actor: CurrentUser, id: string, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const before = await snapshot(tx, id);
    if (!before) throw new ApiError(404, "ไม่พบกลุ่มสิทธิ์");
    await tx.permissionGroup.delete({ where: { id } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_GROUP, entityId: id, action: "DELETE", before, ip });
  });
}
