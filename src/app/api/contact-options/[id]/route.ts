import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { canPickContacts } from "@/lib/contact-rules";
import { formatAddress } from "@/lib/address";

type P = { id: string };

export type ContactAddressOption = { key: string; label: string; recipient: string | null; text: string };


/** ที่อยู่ของผู้ติดต่อ (จดทะเบียน + จัดส่ง) สำหรับเลือกในเอกสาร */
export const GET = apiHandler<P>({}, async ({ user, params }) => {
  if (!canPickContacts(user.permissions)) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const c = await prisma.contact.findFirst({
    where: { id: params.id, deletedAt: null },
    include: { shippingAddresses: { orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] } },
  });
  if (!c) throw new ApiError(404, "ไม่พบผู้ติดต่อ");
  const out: ContactAddressOption[] = [];
  for (const a of c.shippingAddresses) {
    const text = [formatAddress(a), a.phone ? `โทร ${a.phone}` : ""].filter(Boolean).join(" ");
    if (text) out.push({ key: a.id, label: `ที่อยู่จัดส่ง${a.label ? `: ${a.label}` : ""}${a.isDefault ? " (หลัก)" : ""}`, recipient: a.recipient, text });
  }
  const reg = formatAddress({
    address: c.regAddress,
    houseNo: c.regHouseNo,
    moo: c.regMoo,
    soi: c.regSoi,
    road: c.regRoad,
    subdistrict: c.regSubdistrict,
    district: c.regDistrict,
    province: c.regProvince,
    postalCode: c.regPostalCode,
    country: c.regCountry,
  });
  if (reg) out.push({ key: "registered", label: "ที่อยู่จดทะเบียน", recipient: null, text: reg });
  return out;
});
