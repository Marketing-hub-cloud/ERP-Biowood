import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "./db";
import { adminPermissions, can, mergePermissions, type PermissionMap } from "./rbac";
import type { PermissionAction } from "./menu";

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  department: string | null;
  position: string | null;
  avatarKey: string | null;
  isAdmin: boolean;
  permissions: PermissionMap;
};

/**
 * ผู้ใช้ปัจจุบัน — โหลดจาก DB ทุก request (cache ภายใน request เดียว)
 * ถ้าผู้ใช้ถูกหยุดใช้งานหรือถูกลบ จะคืน null ทันทีแม้ JWT ยังไม่หมดอายุ
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    include: { groups: { include: { group: { include: { permissions: true } } } } },
  });
  if (!user || user.status !== "ACTIVE") return null;
  const permissions = user.isAdmin
    ? adminPermissions()
    : mergePermissions(user.groups.flatMap((g) => g.group.permissions));
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    department: user.department,
    position: user.position,
    avatarKey: user.avatarKey,
    isAdmin: user.isAdmin,
    permissions,
  };
});

/** ใช้ใน Server Component: ต้องล็อกอิน */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** ใช้ใน Server Component: ต้องมีสิทธิ์ ไม่งั้นไปหน้า 403 */
export async function requirePagePermission(menuKey: string, action: PermissionAction = "view"): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.permissions, menuKey, action)) redirect("/forbidden");
  return user;
}
