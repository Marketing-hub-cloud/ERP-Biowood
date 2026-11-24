import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { fullName } from "@/lib/format";

/** entityType -> menuKey ที่ต้องมีสิทธิ์ view จึงดูประวัติได้ (เพิ่มเมื่อมีเอกสารใหม่) */
const ENTITY_MENU: Record<string, string> = {
  User: "users.account",
  PermissionGroup: "users.group",
  CompanySetting: "settings.company",
};

export type AuditEntry = {
  id: string;
  action: string;
  actorName: string | null;
  changes: Record<string, [unknown, unknown]> | null;
  after: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  note: string | null;
  createdAt: string;
};

export const GET = apiHandler({}, async ({ req, user }) => {
  const entityType = req.nextUrl.searchParams.get("entityType") ?? "";
  const entityId = req.nextUrl.searchParams.get("entityId") ?? "";
  const menuKey = ENTITY_MENU[entityType];
  if (!menuKey || !entityId) throw new ApiError(400, "พารามิเตอร์ไม่ถูกต้อง");
  // ผู้ใช้ดูประวัติของบัญชีตัวเองได้เสมอ
  const own = entityType === "User" && entityId === user.id;
  if (!own && !can(user.permissions, menuKey, "view")) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");

  const logs = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { firstName: true, lastName: true } } },
  });
  return logs.map(
    (l): AuditEntry => ({
      id: l.id,
      action: l.action,
      actorName: l.actor ? fullName(l.actor) : null,
      changes: l.changes as AuditEntry["changes"],
      after: l.after as AuditEntry["after"],
      before: l.before as AuditEntry["before"],
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    }),
  );
});
