import { describe, expect, it } from "vitest";
import { companySchema, groupSchema, userCreateSchema, userStatusSchema, userUpdateSchema } from "@/lib/validators";

const base = { email: " Test@Example.COM ", firstName: "สมชาย", lastName: "ใจดี" };

describe("validators", () => {
  it("สร้างผู้ใช้: รหัสผ่านต้องตรงกัน", () => {
    const r = userCreateSchema.safeParse({ ...base, password: "12345678", confirmPassword: "12345679" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["confirmPassword"]);
  });

  it("สร้างผู้ใช้: อีเมลถูกแปลงเป็นตัวพิมพ์เล็ก", () => {
    const r = userCreateSchema.parse({ ...base, password: "12345678", confirmPassword: "12345678" });
    expect(r.email).toBe("test@example.com");
  });

  it("แก้ไขผู้ใช้: เว้นรหัสผ่านว่างได้", () => {
    expect(userUpdateSchema.safeParse({ ...base, password: "", confirmPassword: "" }).success).toBe(true);
    expect(userUpdateSchema.safeParse({ ...base, password: "short", confirmPassword: "short" }).success).toBe(false);
  });

  it("หยุดใช้งานต้องมีหมายเหตุสถานะ", () => {
    expect(userStatusSchema.safeParse({ status: "INACTIVE", statusNote: "  " }).success).toBe(false);
    expect(userStatusSchema.safeParse({ status: "INACTIVE", statusNote: "ลาออก" }).success).toBe(true);
  });

  it("กลุ่มสิทธิ์: ห้าม menuKey ที่ไม่รู้จัก", () => {
    const flags = { view: true, create: false, edit: false, delete: false, cancel: false };
    expect(groupSchema.safeParse({ name: "A", permissions: { "purchase.request": flags }, memberIds: [] }).success).toBe(true);
    expect(groupSchema.safeParse({ name: "A", permissions: { "evil.menu": flags }, memberIds: [] }).success).toBe(false);
  });

  it("ข้อมูลบริษัท: เลขผู้เสียภาษี 13 หลัก", () => {
    expect(companySchema.safeParse({ nameTh: "บ", taxId: "123" }).success).toBe(false);
    expect(companySchema.safeParse({ nameTh: "บ", taxId: "0105555555555" }).success).toBe(true);
    expect(companySchema.safeParse({ nameTh: "บ", taxId: "" }).success).toBe(true);
  });
});
