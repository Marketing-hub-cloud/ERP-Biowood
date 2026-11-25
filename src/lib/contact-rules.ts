// สิทธิ์ของผู้ติดต่อตามบทบาท (ลูกค้า/ผู้ขาย) — pure function ใช้ได้ทั้ง client/server
//
// กฎ:
// - ดู / แก้ไข : ต้องมีสิทธิ์นั้นใน "บทบาทใดบทบาทหนึ่ง" ของผู้ติดต่อ
// - ลบ         : ต้องมีสิทธิ์ลบใน "ทุกบทบาท" ของผู้ติดต่อ (กันฝ่ายหนึ่งลบข้อมูลที่อีกฝ่ายใช้อยู่)
// - เพิ่ม/เอาออก บทบาท : ต้องมีสิทธิ์ของบทบาทนั้น (create ตอนสร้าง, edit ตอนแก้ไข)
import { can, type PermissionMap } from "./rbac";
import type { PermissionAction } from "./menu";

export type ContactRole = "customer" | "vendor";
export const CONTACT_ROLES: ContactRole[] = ["customer", "vendor"];
export const ROLE_MENU: Record<ContactRole, string> = { customer: "contacts.customer", vendor: "contacts.vendor" };
export const ROLE_LABEL: Record<ContactRole, string> = { customer: "ลูกค้า", vendor: "ผู้ขาย" };

type RoleFlags = { isCustomer: boolean; isVendor: boolean };

export function rolesOf(c: RoleFlags): ContactRole[] {
  const r: ContactRole[] = [];
  if (c.isCustomer) r.push("customer");
  if (c.isVendor) r.push("vendor");
  return r;
}

export function canRole(perms: PermissionMap, role: ContactRole, action: PermissionAction) {
  return can(perms, ROLE_MENU[role], action);
}

/** บทบาทที่ผู้ใช้ทำ action นี้ได้ */
export function rolesWith(perms: PermissionMap, action: PermissionAction): ContactRole[] {
  return CONTACT_ROLES.filter((r) => canRole(perms, r, action));
}

export function canOnContact(perms: PermissionMap, c: RoleFlags, action: PermissionAction): boolean {
  const roles = rolesOf(c);
  if (roles.length === 0) return false;
  if (action === "delete") return roles.every((r) => canRole(perms, r, "delete"));
  return roles.some((r) => canRole(perms, r, action));
}

/**
 * ตรวจการตั้งบทบาท คืนข้อความ error หรือ null ถ้าผ่าน
 * before = null คือการสร้างใหม่
 */
export function checkRoleChange(perms: PermissionMap, before: RoleFlags | null, after: RoleFlags): string | null {
  const next = rolesOf(after);
  if (next.length === 0) return "กรุณาเลือกประเภทผู้ติดต่ออย่างน้อย 1 ประเภท (ลูกค้า/ผู้ขาย)";
  const action: PermissionAction = before ? "edit" : "create";
  const prev = before ? rolesOf(before) : [];
  const changed = CONTACT_ROLES.filter((r) => prev.includes(r) !== next.includes(r));
  for (const r of changed) {
    if (!canRole(perms, r, action)) return `ไม่มีสิทธิ์${before ? "เปลี่ยน" : "สร้าง"}ผู้ติดต่อประเภท${ROLE_LABEL[r]}`;
  }
  return null;
}

/** เลือกผู้ติดต่อในเอกสารได้: ผู้ที่สร้าง/แก้เอกสารที่ต้องเลือกผู้ติดต่อ (แม้ไม่มีสิทธิ์เมนูผู้ติดต่อ) หรือผู้ที่ดูผู้ติดต่อได้ */
export function canPickContacts(perms: PermissionMap) {
  const docs = ["inventory.issue", "purchase.order", "purchase.return", "engineer.document"];
  return (
    docs.some((m) => can(perms, m, "create") || can(perms, m, "edit")) ||
    can(perms, "contacts.customer", "view") ||
    can(perms, "contacts.vendor", "view")
  );
}
