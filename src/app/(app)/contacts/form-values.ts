// แปลงข้อมูลผู้ติดต่อจาก DB เป็นค่าเริ่มต้นของฟอร์ม (ใช้ฝั่ง server)
import type { ContactFull } from "@/server/contacts";
import type { ContactFormValues } from "./contact-form";

const s = (v: string | null | undefined) => v ?? "";

export const EMPTY_CONTACT_VALUES: ContactFormValues = {
  code: "",
  isCustomer: false,
  isVendor: false,
  entityType: "JURISTIC",
  name: "",
  taxId: "",
  branch: "สำนักงานใหญ่",
  sourceId: null,
  customerBusinessTypeId: null,
  note: "",
  reg: { address: "", houseNo: "", moo: "", soi: "", road: "", subdistrict: "", district: "", province: "", postalCode: "", country: "ไทย" },
  shippingAddresses: [],
  channels: [{ _k: "c0", type: "PHONE", value: "", note: "" }],
  persons: [],
  tagIds: [],
};

export function toFormValues(c: ContactFull): ContactFormValues {
  return {
    code: c.code,
    isCustomer: c.isCustomer,
    isVendor: c.isVendor,
    entityType: c.entityType,
    name: c.name,
    taxId: s(c.taxId),
    branch: s(c.branch),
    sourceId: c.sourceId,
    customerBusinessTypeId: c.customerBusinessTypeId,
    note: s(c.note),
    reg: {
      address: s(c.regAddress),
      houseNo: s(c.regHouseNo),
      moo: s(c.regMoo),
      soi: s(c.regSoi),
      road: s(c.regRoad),
      subdistrict: s(c.regSubdistrict),
      district: s(c.regDistrict),
      province: s(c.regProvince),
      postalCode: s(c.regPostalCode),
      country: c.regCountry,
    },
    shippingAddresses: c.shippingAddresses.map((a) => ({
      _k: a.id,
      label: s(a.label),
      recipient: s(a.recipient),
      phone: s(a.phone),
      isDefault: a.isDefault,
      address: s(a.address),
      houseNo: s(a.houseNo),
      moo: s(a.moo),
      soi: s(a.soi),
      road: s(a.road),
      subdistrict: s(a.subdistrict),
      district: s(a.district),
      province: s(a.province),
      postalCode: s(a.postalCode),
      country: a.country,
    })),
    channels: c.channels.map((ch) => ({ _k: ch.id, type: ch.type, value: ch.value, note: s(ch.note) })),
    persons: c.persons.map((p) => ({
      _k: p.id,
      name: p.name,
      position: s(p.position),
      phone: s(p.phone),
      email: s(p.email),
      lineId: s(p.lineId),
      note: s(p.note),
      isPrimary: p.isPrimary,
    })),
    tagIds: c.tags.map((t) => t.tagId),
  };
}
