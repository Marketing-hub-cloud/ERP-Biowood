import { describe, expect, it } from "vitest";
import { adminPermissions, can, flagsToRow, mergePermissions, normalizeFlags, visibleMenu } from "@/lib/rbac";
import { PERMISSION_MENU_KEYS } from "@/lib/menu";

describe("normalizeFlags", () => {
  it("ปิด view แล้วสิทธิ์อื่นต้องปิดทั้งหมด", () => {
    expect(normalizeFlags("purchase.request", { view: false, create: true, edit: true, delete: true, cancel: true })).toEqual({
      view: false,
      create: false,
      edit: false,
      delete: false,
      cancel: false,
      approve: false,
    });
  });

  it("ปิดสิทธิ์ที่เมนูไม่รองรับ (รายงานมีแค่ view)", () => {
    expect(normalizeFlags("purchase.report", { view: true, create: true, edit: true })).toEqual({
      view: true,
      create: false,
      edit: false,
      delete: false,
      cancel: false,
      approve: false,
    });
  });

  it("สิทธิ์อนุมัติมีเฉพาะเมนูเอกสารที่ผ่าน approval engine", () => {
    expect(normalizeFlags("purchase.order", { view: true, approve: true }).approve).toBe(true);
    expect(normalizeFlags("inventory.receipt", { view: true, approve: true }).approve).toBe(false);
  });

  it("menuKey ที่ไม่รู้จักได้สิทธิ์ว่าง", () => {
    expect(normalizeFlags("unknown.menu", { view: true }).view).toBe(false);
  });
});

describe("mergePermissions (หลายกลุ่มรวมแบบ OR)", () => {
  it("รวมสิทธิ์จากหลายกลุ่ม", () => {
    const groupA = flagsToRow("purchase.request", { view: true, create: true });
    const groupB = flagsToRow("purchase.request", { view: true, edit: true });
    const groupC = flagsToRow("purchase.order", { view: true });
    const map = mergePermissions([groupA, groupB, groupC]);
    expect(map["purchase.request"]).toEqual({ view: true, create: true, edit: true, delete: false, cancel: false, approve: false });
    expect(map["purchase.order"].view).toBe(true);
  });

  it("แถวที่บันทึกไม่ถูกกฎ (view ปิดแต่ create เปิด) ต้องไม่ได้สิทธิ์", () => {
    const map = mergePermissions([{ menuKey: "purchase.request", canView: false, canCreate: true, canEdit: false, canDelete: false, canCancel: false, canApprove: false }]);
    expect(can(map, "purchase.request", "create")).toBe(false);
  });

  it("ข้าม menuKey ที่ไม่รู้จัก", () => {
    const map = mergePermissions([{ menuKey: "hack.menu", canView: true, canCreate: true, canEdit: true, canDelete: true, canCancel: true, canApprove: true }]);
    expect(map["hack.menu"]).toBeUndefined();
  });
});

describe("can / visibleMenu", () => {
  it("admin ได้ทุกเมนู", () => {
    const perms = adminPermissions();
    for (const key of PERMISSION_MENU_KEYS) expect(can(perms, key, "view")).toBe(true);
    expect(can(perms, "users.account", "cancel")).toBe(true);
  });

  it("ไม่มีสิทธิ์ view เมนูใด เมนูนั้นหายจาก sidebar", () => {
    const perms = mergePermissions([flagsToRow("purchase.request", { view: true })]);
    const menu = visibleMenu(perms);
    const keys = menu.flatMap((s) => s.items.map((i) => i.key));
    expect(keys).toContain("purchase.request");
    expect(keys).not.toContain("purchase.order");
    expect(keys).not.toContain("users.account");
    // เมนู public (แก้ไขข้อมูลส่วนตัว) เห็นเสมอ
    expect(keys).toContain("users.profile");
    // section ที่ว่างต้องหายไป
    expect(menu.map((s) => s.key)).not.toContain("crm");
  });
});
