// Logic สิทธิ์แบบ pure function (ไม่แตะ DB) — ใช้ได้ทั้ง client และ server
import { MENU, PERMISSION_ACTIONS, PERMISSION_MENU_KEYS, findMenuItem, type MenuSection, type PermissionAction } from "./menu";

export type PermissionFlags = Record<PermissionAction, boolean>;
/** menuKey -> flags */
export type PermissionMap = Record<string, PermissionFlags>;

export type GroupPermissionRow = {
  menuKey: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canCancel: boolean;
  canApprove: boolean;
};

export const EMPTY_FLAGS: PermissionFlags = { view: false, create: false, edit: false, delete: false, cancel: false, approve: false };

/**
 * ทำให้สิทธิ์ของเมนูหนึ่งถูกต้องตามกฎ:
 * - ถ้า view ปิด สิทธิ์อื่นปิดทั้งหมด
 * - สิทธิ์ที่เมนูนั้นไม่รองรับจะถูกปิด
 */
export function normalizeFlags(menuKey: string, flags: Partial<PermissionFlags>): PermissionFlags {
  const item = findMenuItem(menuKey);
  const allowed = new Set(item?.actions ?? []);
  const out: PermissionFlags = { ...EMPTY_FLAGS };
  if (!flags.view || !allowed.has("view")) return out;
  for (const a of PERMISSION_ACTIONS) out[a] = Boolean(flags[a]) && allowed.has(a);
  return out;
}

export function rowToFlags(row: GroupPermissionRow): PermissionFlags {
  return normalizeFlags(row.menuKey, {
    view: row.canView,
    create: row.canCreate,
    edit: row.canEdit,
    delete: row.canDelete,
    cancel: row.canCancel,
    approve: row.canApprove,
  });
}

export function flagsToRow(menuKey: string, flags: Partial<PermissionFlags>): GroupPermissionRow {
  const f = normalizeFlags(menuKey, flags);
  return { menuKey, canView: f.view, canCreate: f.create, canEdit: f.edit, canDelete: f.delete, canCancel: f.cancel, canApprove: f.approve };
}

/** รวมสิทธิ์จากหลายกลุ่มแบบ OR */
export function mergePermissions(rows: GroupPermissionRow[]): PermissionMap {
  const map: PermissionMap = {};
  for (const row of rows) {
    if (!PERMISSION_MENU_KEYS.includes(row.menuKey)) continue;
    const f = rowToFlags(row);
    const cur = map[row.menuKey] ?? { ...EMPTY_FLAGS };
    for (const a of PERMISSION_ACTIONS) cur[a] = cur[a] || f[a];
    map[row.menuKey] = cur;
  }
  return map;
}

/** admin ได้ทุกสิทธิ์ที่เมนูรองรับ */
export function adminPermissions(): PermissionMap {
  const map: PermissionMap = {};
  for (const key of PERMISSION_MENU_KEYS) {
    const item = findMenuItem(key)!;
    map[key] = normalizeFlags(key, Object.fromEntries(item.actions.map((a) => [a, true])));
  }
  return map;
}

export function can(perms: PermissionMap, menuKey: string, action: PermissionAction): boolean {
  const item = findMenuItem(menuKey);
  if (item?.public) return true;
  return Boolean(perms[menuKey]?.view && perms[menuKey]?.[action]);
}

/** เมนูที่ผู้ใช้เห็นใน sidebar (ตัด section ที่ว่างออก) */
export function visibleMenu(perms: PermissionMap): MenuSection[] {
  return MENU.map((s) => ({ ...s, items: s.items.filter((i) => i.public || can(perms, i.key, "view")) })).filter(
    (s) => s.items.length > 0,
  );
}
