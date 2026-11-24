import { describe, expect, it } from "vitest";
import { canOnContact, checkRoleChange, rolesWith } from "@/lib/contact-rules";
import { flagsToRow, mergePermissions } from "@/lib/rbac";
import { formatAddress } from "@/lib/address";
import { contactSchema } from "@/lib/validators";

const perms = (p: Record<string, Partial<Record<"view" | "create" | "edit" | "delete" | "cancel", boolean>>>) =>
  mergePermissions(Object.entries(p).map(([k, f]) => flagsToRow(k, f)));

const VENDOR_ONLY = perms({ "contacts.vendor": { view: true, create: true, edit: true, delete: true } });
const CUSTOMER_VIEW = perms({ "contacts.customer": { view: true } });
const BOTH_EDIT = perms({ "contacts.customer": { view: true, edit: true }, "contacts.vendor": { view: true, edit: true, delete: true } });

describe("สิทธิ์ผู้ติดต่อตามบทบาท", () => {
  it("ดูได้ถ้ามีสิทธิ์บทบาทใดบทบาทหนึ่ง", () => {
    expect(canOnContact(VENDOR_ONLY, { isCustomer: true, isVendor: true }, "view")).toBe(true);
    expect(canOnContact(VENDOR_ONLY, { isCustomer: true, isVendor: false }, "view")).toBe(false);
    expect(canOnContact(CUSTOMER_VIEW, { isCustomer: true, isVendor: false }, "edit")).toBe(false);
  });

  it("ลบต้องมีสิทธิ์ลบทุกบทบาท", () => {
    expect(canOnContact(VENDOR_ONLY, { isCustomer: false, isVendor: true }, "delete")).toBe(true);
    expect(canOnContact(VENDOR_ONLY, { isCustomer: true, isVendor: true }, "delete")).toBe(false);
    expect(canOnContact(BOTH_EDIT, { isCustomer: true, isVendor: true }, "delete")).toBe(false);
  });

  it("rolesWith", () => {
    expect(rolesWith(VENDOR_ONLY, "view")).toEqual(["vendor"]);
    expect(rolesWith(CUSTOMER_VIEW, "create")).toEqual([]);
  });

  it("สร้าง: ติ๊กบทบาทที่ไม่มีสิทธิ์สร้างไม่ได้", () => {
    expect(checkRoleChange(VENDOR_ONLY, null, { isCustomer: false, isVendor: true })).toBeNull();
    expect(checkRoleChange(VENDOR_ONLY, null, { isCustomer: true, isVendor: true })).toMatch(/ลูกค้า/);
    expect(checkRoleChange(VENDOR_ONLY, null, { isCustomer: false, isVendor: false })).toMatch(/อย่างน้อย 1/);
  });

  it("แก้ไข: เพิ่ม/เอาออกบทบาทต้องมีสิทธิ์แก้ไขบทบาทนั้น แต่บทบาทที่ไม่เปลี่ยนไม่ต้องมีสิทธิ์", () => {
    const both = { isCustomer: true, isVendor: true };
    // ฝ่ายจัดซื้อแก้ข้อมูลผู้ติดต่อที่เป็นทั้งสองบทบาทได้ ถ้าไม่แตะบทบาทลูกค้า
    expect(checkRoleChange(VENDOR_ONLY, both, both)).toBeNull();
    // แต่เอาบทบาทลูกค้าออกไม่ได้
    expect(checkRoleChange(VENDOR_ONLY, both, { isCustomer: false, isVendor: true })).toMatch(/ลูกค้า/);
    expect(checkRoleChange(BOTH_EDIT, both, { isCustomer: false, isVendor: true })).toBeNull();
  });
});

describe("formatAddress", () => {
  it("กรุงเทพฯ ใช้ แขวง/เขต", () => {
    expect(
      formatAddress({ houseNo: "99/9", road: "บางนา-ตราด", subdistrict: "บางนาใต้", district: "บางนา", province: "กรุงเทพมหานคร", postalCode: "10260", country: "ไทย" }),
    ).toBe("99/9 ถนนบางนา-ตราด แขวงบางนาใต้ เขตบางนา กรุงเทพมหานคร 10260");
  });

  it("ต่างจังหวัดใช้ ตำบล/อำเภอ/จังหวัด", () => {
    expect(formatAddress({ houseNo: "1", moo: "2", subdistrict: "บางกระสอ", district: "เมืองนนทบุรี", province: "นนทบุรี", postalCode: "11000" })).toBe(
      "1 หมู่ 2 ตำบลบางกระสอ อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000",
    );
  });

  it("ต่างประเทศแสดงชื่อประเทศ", () => {
    expect(formatAddress({ address: "1 Main St", country: "Singapore" })).toBe("1 Main St Singapore");
  });
});

const base = {
  isCustomer: true,
  isVendor: false,
  entityType: "JURISTIC" as const,
  name: "บริษัท ทดสอบ",
  reg: {},
  shippingAddresses: [],
  channels: [],
  persons: [],
  tagIds: [],
};

describe("contactSchema", () => {
  it("ต้องเลือกบทบาทอย่างน้อย 1", () => {
    const r = contactSchema.safeParse({ ...base, isCustomer: false });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["isCustomer"]);
  });

  it("เลขผู้เสียภาษี 13 หลัก (ตัดขีด/ช่องว่างให้)", () => {
    expect(contactSchema.parse({ ...base, taxId: "0-1055-00000-00-1" }).taxId).toBe("0105500000001");
    expect(contactSchema.safeParse({ ...base, taxId: "12345" }).success).toBe(false);
  });

  it("รหัสแปลงเป็นตัวพิมพ์ใหญ่ และห้ามอักขระพิเศษ", () => {
    expect(contactSchema.parse({ ...base, code: "ct-01" }).code).toBe("CT-01");
    expect(contactSchema.safeParse({ ...base, code: "ก001" }).success).toBe(false);
  });

  it("ช่องทางอีเมลต้องเป็นอีเมล", () => {
    const r = contactSchema.safeParse({ ...base, channels: [{ type: "EMAIL", value: "not-email" }] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["channels", 0, "value"]);
    expect(contactSchema.safeParse({ ...base, channels: [{ type: "LINE", value: "not-email" }] }).success).toBe(true);
  });

  it("บุคคลติดต่อต้องมีชื่อ และประเทศว่าง = ไทย", () => {
    expect(contactSchema.safeParse({ ...base, persons: [{ name: " " }] }).success).toBe(false);
    expect(contactSchema.parse({ ...base, reg: { country: "" } }).reg.country).toBe("ไทย");
  });
});
