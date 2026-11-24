import { ApiError, apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatAddress } from "@/lib/address";
import { formatDateTime } from "@/lib/format";
import { rolesWith } from "@/lib/contact-rules";
import { CHANNEL_LABELS, contactSchema } from "@/lib/validators";
import { createContact, visibleContactWhere } from "@/server/contacts";
import type { Prisma } from "@/generated/prisma/client";
import type { ChannelType } from "@/generated/prisma/enums";

const SORTABLE = ["code", "name", "entityType", "createdAt", "updatedAt"];

export type ContactRow = {
  id: string;
  code: string;
  isCustomer: boolean;
  isVendor: boolean;
  name: string;
  entityType: "JURISTIC" | "INDIVIDUAL";
  taxId: string | null;
  customerBusinessType: string | null;
  source: string | null;
  tags: string[];
  province: string | null;
  primaryChannel: { type: ChannelType; value: string } | null;
  primaryPerson: string | null;
  projectCount: number;
  createdAt: string;
};

const listInclude = {
  channels: { orderBy: { sortOrder: "asc" } },
  persons: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1 },
  tags: { include: { tag: true } },
  source: true,
  customerBusinessType: true,
} satisfies Prisma.ContactInclude;

type ListContact = Prisma.ContactGetPayload<{ include: typeof listInclude }>;

const toRow = (c: ListContact): ContactRow => ({
  id: c.id,
  code: c.code,
  isCustomer: c.isCustomer,
  isVendor: c.isVendor,
  name: c.name,
  entityType: c.entityType,
  taxId: c.taxId,
  customerBusinessType: c.customerBusinessType?.label ?? null,
  source: c.source?.label ?? null,
  tags: c.tags.map((t) => t.tag.name),
  province: c.regProvince,
  primaryChannel: c.channels[0] ? { type: c.channels[0].type, value: c.channels[0].value } : null,
  primaryPerson: c.persons[0]?.name ?? null,
  projectCount: 0, // โครงการ CRM มาในเฟส 8
  createdAt: c.createdAt.toISOString(),
});

export const GET = apiHandler({}, async ({ req, user }) => {
  if (rolesWith(user.permissions, "view").length === 0) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.ContactWhereInput[] = [visibleContactWhere(user)];

  if (p.filters.role === "customer") and.push({ isCustomer: true });
  if (p.filters.role === "vendor") and.push({ isVendor: true });
  if (p.filters.entityType === "JURISTIC" || p.filters.entityType === "INDIVIDUAL") and.push({ entityType: p.filters.entityType });
  if (p.filters.businessType) and.push({ customerBusinessTypeId: p.filters.businessType });
  if (p.filters.source) and.push({ sourceId: p.filters.source });
  if (p.filters.tag) and.push({ tags: { some: { tagId: p.filters.tag } } });
  if (p.filters.province) and.push({ regProvince: p.filters.province });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { name: contains },
        { code: contains },
        { taxId: contains },
        { channels: { some: { value: contains } } },
        { persons: { some: { OR: [{ name: contains }, { phone: contains }, { email: contains }] } } },
      ],
    });
  }
  const where: Prisma.ContactWhereInput = { AND: and };
  const orderBy: Prisma.ContactOrderByWithRelationInput = p.sort ? { [p.sort.field]: p.sort.dir } : { createdAt: "desc" };

  if (p.format === "csv") {
    const all = await prisma.contact.findMany({
      where,
      orderBy,
      include: { ...listInclude, persons: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }] } },
    });
    const channelOf = (c: (typeof all)[number], types: ChannelType[]) =>
      c.channels.filter((ch) => types.includes(ch.type)).map((ch) => ch.value).join(", ");
    const csv = toCsv(all, [
      { header: "รหัส", value: (c) => c.code },
      { header: "ประเภท", value: (c) => [c.isCustomer && "ลูกค้า", c.isVendor && "ผู้ขาย"].filter(Boolean).join(", ") },
      { header: "ชื่อ", value: (c) => c.name },
      { header: "ประเภทกิจการ", value: (c) => (c.entityType === "JURISTIC" ? "นิติบุคคล" : "บุคคลธรรมดา") },
      { header: "เลขประจำตัวผู้เสียภาษี", value: (c) => c.taxId },
      { header: "สาขา", value: (c) => c.branch },
      { header: "ประเภทกิจการของลูกค้า", value: (c) => c.customerBusinessType?.label },
      { header: "ช่องทางที่รู้จัก", value: (c) => c.source?.label },
      { header: "กลุ่ม", value: (c) => c.tags.map((t) => t.tag.name).join(", ") },
      { header: "โทรศัพท์", value: (c) => channelOf(c, ["PHONE", "MOBILE"]) },
      { header: "อีเมล", value: (c) => channelOf(c, ["EMAIL"]) },
      { header: "LINE", value: (c) => channelOf(c, ["LINE"]) },
      {
        header: "ช่องทางอื่น",
        value: (c) =>
          c.channels
            .filter((ch) => !["PHONE", "MOBILE", "EMAIL", "LINE"].includes(ch.type))
            .map((ch) => `${CHANNEL_LABELS[ch.type]}: ${ch.value}`)
            .join(", "),
      },
      {
        header: "ที่อยู่จดทะเบียน",
        value: (c) =>
          formatAddress({
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
      },
      { header: "จังหวัด", value: (c) => c.regProvince },
      { header: "บุคคลติดต่อ", value: (c) => c.persons.map((x) => [x.name, x.position && `(${x.position})`, x.phone].filter(Boolean).join(" ")).join("; ") },
      { header: "จำนวนโครงการ", value: () => 0 },
      { header: "วันที่สร้าง", value: (c) => formatDateTime(c.createdAt) },
    ]);
    const name = p.filters.role === "customer" ? "customers" : p.filters.role === "vendor" ? "vendors" : "contacts";
    return csvResponse(csv, `${name}.csv`);
  }

  const [total, rows] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({ where, orderBy, include: listInclude, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return { rows: rows.map(toRow), total, page: p.page, pageSize: p.pageSize } satisfies ListResult<ContactRow>;
});

export const POST = apiHandler({}, async ({ req, user, ip }) => {
  if (rolesWith(user.permissions, "create").length === 0) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const data = contactSchema.parse(await readJson(req));
  const c = await createContact(user, data, ip);
  return { id: c.id, code: c.code };
});
