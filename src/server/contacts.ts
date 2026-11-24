import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { allocateRunningCode } from "@/lib/doc-number";
import { formatAddress } from "@/lib/address";
import { canOnContact, checkRoleChange, rolesWith } from "@/lib/contact-rules";
import { CHANNEL_LABELS, type ContactData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";
import type { PermissionAction } from "@/lib/menu";

export const ENTITY_CONTACT = "Contact";
export const CONTACT_CODE_PREFIX = "CT";

export const contactInclude = {
  shippingAddresses: { orderBy: { sortOrder: "asc" } },
  channels: { orderBy: { sortOrder: "asc" } },
  persons: { orderBy: { sortOrder: "asc" } },
  tags: { include: { tag: true } },
  source: true,
  customerBusinessType: true,
} satisfies Prisma.ContactInclude;

export type ContactFull = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

/** where สำหรับผู้ติดต่อที่ผู้ใช้มีสิทธิ์ดู (ตามบทบาท) */
export function visibleContactWhere(user: CurrentUser): Prisma.ContactWhereInput {
  const roles = rolesWith(user.permissions, "view");
  const or: Prisma.ContactWhereInput[] = [];
  if (roles.includes("customer")) or.push({ isCustomer: true });
  if (roles.includes("vendor")) or.push({ isVendor: true });
  return { deletedAt: null, OR: or.length ? or : [{ id: "__none__" }] };
}

/** โหลดผู้ติดต่อ + ตรวจสิทธิ์ (404 ถ้าไม่มี/ถูกลบ, 403 ถ้าไม่มีสิทธิ์) */
export async function getContactFor(user: CurrentUser, id: string, action: PermissionAction = "view") {
  const c = await prisma.contact.findFirst({ where: { id, deletedAt: null }, include: contactInclude });
  if (!c) throw new ApiError(404, "ไม่พบผู้ติดต่อ");
  if (!canOnContact(user.permissions, c, action)) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  return c;
}

/** snapshot อ่านง่ายสำหรับ audit log */
function snapshot(c: ContactFull) {
  return {
    code: c.code,
    roles: [c.isCustomer && "ลูกค้า", c.isVendor && "ผู้ขาย"].filter(Boolean),
    entityType: c.entityType === "JURISTIC" ? "นิติบุคคล" : "บุคคลธรรมดา",
    name: c.name,
    taxId: c.taxId,
    branch: c.branch,
    source: c.source?.label ?? null,
    customerBusinessType: c.customerBusinessType?.label ?? null,
    note: c.note,
    photoKey: c.photoKey,
    regAddressText: formatAddress({
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
    }),
    shippingAddresses: c.shippingAddresses.map(
      (a) => `${a.isDefault ? "[หลัก] " : ""}${a.label ? a.label + ": " : ""}${formatAddress(a)}${a.recipient ? ` (${a.recipient} ${a.phone ?? ""})` : ""}`.trim(),
    ),
    channels: c.channels.map((ch) => `${CHANNEL_LABELS[ch.type]}: ${ch.value}`),
    persons: c.persons.map((p) => [p.isPrimary ? "[หลัก]" : "", p.name, p.position && `(${p.position})`, p.phone, p.email].filter(Boolean).join(" ")),
    tags: c.tags.map((t) => t.tag.name).sort(),
  };
}

async function loadFull(tx: TxClient, id: string) {
  return tx.contact.findUniqueOrThrow({ where: { id }, include: contactInclude });
}

function scalarData(d: ContactData) {
  return {
    isCustomer: d.isCustomer,
    isVendor: d.isVendor,
    entityType: d.entityType,
    name: d.name,
    taxId: d.taxId,
    branch: d.branch,
    sourceId: d.sourceId,
    customerBusinessTypeId: d.customerBusinessTypeId,
    note: d.note,
    regAddress: d.reg.address,
    regHouseNo: d.reg.houseNo,
    regMoo: d.reg.moo,
    regSoi: d.reg.soi,
    regRoad: d.reg.road,
    regSubdistrict: d.reg.subdistrict,
    regDistrict: d.reg.district,
    regProvince: d.reg.province,
    regPostalCode: d.reg.postalCode,
    regCountry: d.reg.country,
  };
}

/** ให้มี "หลัก" ได้แค่รายการเดียว: ใช้รายการแรกที่ติ๊ก ถ้าไม่มีเลยใช้รายการแรก */
function singleFlag<T>(items: T[], get: (i: T) => boolean): boolean[] {
  const idx = Math.max(0, items.findIndex(get));
  return items.map((_, i) => i === idx);
}

async function writeChildren(tx: TxClient, contactId: string, d: ContactData) {
  await tx.contactAddress.deleteMany({ where: { contactId } });
  await tx.contactChannel.deleteMany({ where: { contactId } });
  await tx.contactPerson.deleteMany({ where: { contactId } });
  await tx.contactTag.deleteMany({ where: { contactId } });

  const defaults = singleFlag(d.shippingAddresses, (a) => a.isDefault);
  if (d.shippingAddresses.length) {
    await tx.contactAddress.createMany({
      data: d.shippingAddresses.map((a, i) => ({ ...a, contactId, isDefault: defaults[i], sortOrder: i })),
    });
  }
  if (d.channels.length) {
    await tx.contactChannel.createMany({ data: d.channels.map((c, i) => ({ ...c, contactId, sortOrder: i })) });
  }
  const primaries = singleFlag(d.persons, (p) => p.isPrimary);
  if (d.persons.length) {
    await tx.contactPerson.createMany({ data: d.persons.map((p, i) => ({ ...p, contactId, isPrimary: primaries[i], sortOrder: i })) });
  }
  const tagIds = [...new Set(d.tagIds)];
  if (tagIds.length) {
    const n = await tx.tag.count({ where: { id: { in: tagIds } } });
    if (n !== tagIds.length) throw new ApiError(400, "ไม่พบกลุ่ม (tag) บางรายการ");
    await tx.contactTag.createMany({ data: tagIds.map((tagId) => ({ contactId, tagId })) });
  }
}

async function assertLookups(tx: TxClient, d: ContactData) {
  if (d.sourceId) {
    const o = await tx.lookupOption.findFirst({ where: { id: d.sourceId, kind: "CONTACT_SOURCE" } });
    if (!o) throw new ApiError(400, "ไม่พบช่องทางที่รู้จัก", { sourceId: "ไม่พบตัวเลือกนี้" });
  }
  if (d.customerBusinessTypeId) {
    const o = await tx.lookupOption.findFirst({ where: { id: d.customerBusinessTypeId, kind: "CUSTOMER_BUSINESS_TYPE" } });
    if (!o) throw new ApiError(400, "ไม่พบประเภทกิจการของลูกค้า", { customerBusinessTypeId: "ไม่พบตัวเลือกนี้" });
  }
}

async function assertCodeFree(tx: TxClient, code: string, exceptId?: string) {
  const dup = await tx.contact.findUnique({ where: { code } });
  if (dup && dup.id !== exceptId) throw new ApiError(409, "รหัสผู้ติดต่อนี้ถูกใช้แล้ว", { code: "รหัสนี้ถูกใช้แล้ว" });
}

/** ออกรหัสอัตโนมัติ ข้ามเลขที่ถูกใช้ไปแล้ว (เช่น ผู้ใช้เคยตั้งรหัส CT00010 เอง) */
async function nextFreeCode(tx: TxClient) {
  for (let i = 0; i < 1000; i++) {
    const code = await allocateRunningCode(tx, CONTACT_CODE_PREFIX);
    if (!(await tx.contact.findUnique({ where: { code } }))) return code;
  }
  throw new ApiError(500, "ไม่สามารถสร้างรหัสผู้ติดต่อได้");
}

export async function createContact(actor: CurrentUser, d: ContactData, ip: string | null) {
  const err = checkRoleChange(actor.permissions, null, d);
  if (err) throw new ApiError(403, err);
  return prisma.$transaction(async (tx) => {
    await assertLookups(tx, d);
    const code = d.code ?? (await nextFreeCode(tx));
    if (d.code) await assertCodeFree(tx, code);
    const c = await tx.contact.create({ data: { ...scalarData(d), code, createdById: actor.id } });
    await writeChildren(tx, c.id, d);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_CONTACT, entityId: c.id, action: "CREATE", after: snapshot(await loadFull(tx, c.id)), ip });
    return c;
  });
}

export async function updateContact(actor: CurrentUser, id: string, d: ContactData, ip: string | null) {
  const current = await getContactFor(actor, id, "edit");
  const err = checkRoleChange(actor.permissions, current, d);
  if (err) throw new ApiError(403, err);
  return prisma.$transaction(async (tx) => {
    await assertLookups(tx, d);
    const code = d.code ?? current.code;
    if (code !== current.code) await assertCodeFree(tx, code, id);
    const before = snapshot(await loadFull(tx, id));
    await tx.contact.update({ where: { id }, data: { ...scalarData(d), code } });
    await writeChildren(tx, id, d);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_CONTACT, entityId: id, action: "UPDATE", before, after: snapshot(await loadFull(tx, id)), ip });
  });
}

export async function deleteContact(actor: CurrentUser, id: string, ip: string | null) {
  const c = await getContactFor(actor, id, "delete");
  // TODO(เฟส 5+): ตรวจว่ามีเอกสารอ้างอิงผู้ติดต่อนี้หรือไม่ ก่อนลบ
  await prisma.$transaction(async (tx) => {
    await tx.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_CONTACT, entityId: id, action: "DELETE", before: snapshot(c), ip });
  });
}

export async function setContactPhoto(actor: CurrentUser, id: string, photoKey: string | null, ip: string | null) {
  const c = await getContactFor(actor, id, "edit");
  await prisma.$transaction(async (tx) => {
    await tx.contact.update({ where: { id }, data: { photoKey } });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_CONTACT,
      entityId: id,
      action: "UPDATE",
      before: { photoKey: c.photoKey },
      after: { photoKey },
      note: photoKey ? "เปลี่ยนรูปผู้ติดต่อ" : "ลบรูปผู้ติดต่อ",
      ip,
    });
  });
  return c.photoKey; // รูปเดิม (ให้ผู้เรียกลบไฟล์)
}

/** ผู้ใช้มีสิทธิ์สร้าง/แก้ไขผู้ติดต่อบทบาทใดก็ได้ → เพิ่มตัวเลือก/tag ได้ */
export function canManageContactOptions(user: CurrentUser) {
  return rolesWith(user.permissions, "create").length > 0 || rolesWith(user.permissions, "edit").length > 0;
}

export async function getContactFormOptions() {
  const [lookups, tags] = await Promise.all([
    prisma.lookupOption.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    sources: lookups.filter((l) => l.kind === "CONTACT_SOURCE").map((l) => ({ id: l.id, label: l.label })),
    businessTypes: lookups.filter((l) => l.kind === "CUSTOMER_BUSINESS_TYPE").map((l) => ({ id: l.id, label: l.label })),
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
  };
}
export type ContactFormOptions = Awaited<ReturnType<typeof getContactFormOptions>>;
