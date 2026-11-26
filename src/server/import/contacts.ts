import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { parseBool, splitList } from "@/lib/csv-parse";
import { contactSchema, type ContactData, type ContactInput } from "@/lib/validators";
import { createContact, ENTITY_CONTACT } from "@/server/contacts";
import { csvRow, errorText, headerFor, LookupResolver, tagIds, type ImportPlan, type Importer, type RowError } from "./common";

const ENTITY = { "นิติบุคคล": "JURISTIC", "บุคคลธรรมดา": "INDIVIDUAL" } as const;

const CHANNEL_COLUMNS = [
  ["โทรศัพท์", "PHONE"],
  ["มือถือ", "MOBILE"],
  ["อีเมล", "EMAIL"],
  ["LINE", "LINE"],
  ["Facebook", "FACEBOOK"],
  ["เว็บไซต์", "WEBSITE"],
  ["แฟกซ์", "FAX"],
] as const;

const FIELD_HEADERS: Record<string, string> = {
  code: "รหัส",
  name: "ชื่อ",
  isCustomer: "ลูกค้า",
  isVendor: "ผู้ขาย",
  taxId: "เลขประจำตัวผู้เสียภาษี",
  branch: "สาขา",
  note: "หมายเหตุ",
  "reg.address": "ที่อยู่",
  "reg.houseNo": "เลขที่",
  "reg.moo": "หมู่",
  "reg.soi": "ซอย",
  "reg.road": "ถนน",
  "reg.subdistrict": "แขวง/ตำบล",
  "reg.district": "เขต/อำเภอ",
  "reg.province": "จังหวัด",
  "reg.postalCode": "รหัสไปรษณีย์",
  "reg.country": "ประเทศ",
  "shippingAddresses.*.recipient": "ผู้รับ",
  "shippingAddresses.*.phone": "เบอร์ผู้รับ",
  shippingAddresses: "ที่อยู่จัดส่ง",
  channels: "ช่องทางติดต่อ (โทรศัพท์/อีเมล/LINE…)",
  "persons.*.name": "บุคคลติดต่อ",
  "persons.*.position": "ตำแหน่ง",
  "persons.*.phone": "เบอร์บุคคลติดต่อ",
  "persons.*.email": "อีเมลบุคคลติดต่อ",
  "persons.*.lineId": "LINE บุคคลติดต่อ",
};

type ContactRow = { input: ContactInput; source: string; businessType: string; tags: string[] };

export const contactsImporter: Importer<ContactRow> & { lookups?: LookupResolver } = {
  kind: "contacts",
  title: "ผู้ติดต่อ (ลูกค้า/ผู้ขาย)",
  description: "1 แถว = ผู้ติดต่อ 1 ราย (บุคคลติดต่อหลัก 1 คน — คนอื่นใช้ไฟล์ contact-persons) รหัสซ้ำกับที่มีอยู่จะข้าม",
  columns: [
    { header: "รหัส", example: "C0001", help: "ว่าง = ออกรหัสอัตโนมัติ (CT00001…); มีอยู่แล้ว = ข้ามแถวนี้" },
    { header: "ชื่อ", required: true, example: "บริษัท ตัวอย่าง จำกัด", help: "ชื่อกิจการ/ชื่อ-นามสกุล" },
    { header: "ลูกค้า", example: "ใช่", help: "ใช่/ไม่ (ต้องเป็นลูกค้าหรือผู้ขายอย่างน้อย 1 อย่าง)" },
    { header: "ผู้ขาย", example: "ไม่", help: "ใช่/ไม่" },
    { header: "ประเภทกิจการ", example: "นิติบุคคล", help: "นิติบุคคล / บุคคลธรรมดา (ว่าง = นิติบุคคล)" },
    { header: "เลขประจำตัวผู้เสียภาษี", example: "0105551234567", help: "13 หลัก (มีขีด/เว้นวรรคได้)" },
    { header: "สาขา", example: "สำนักงานใหญ่", help: "" },
    { header: "ช่องทางที่รู้จัก", example: "Facebook", help: "ไม่มีในระบบ = สร้างตัวเลือกใหม่" },
    { header: "ประเภทกิจการของลูกค้า", example: "ผู้รับเหมา", help: "ไม่มีในระบบ = สร้างตัวเลือกใหม่" },
    { header: "กลุ่ม", example: "VIP, กรุงเทพ", help: "หลายกลุ่มคั่นด้วย , (ไม่มี = สร้างใหม่)" },
    { header: "ที่อยู่", example: "อาคารตัวอย่าง ชั้น 5", help: "ที่อยู่จดทะเบียน: อาคาร/หมู่บ้าน" },
    { header: "เลขที่", example: "99/1", help: "" },
    { header: "หมู่", example: "", help: "" },
    { header: "ซอย", example: "สุขุมวิท 1", help: "" },
    { header: "ถนน", example: "สุขุมวิท", help: "" },
    { header: "แขวง/ตำบล", example: "คลองเตย", help: "" },
    { header: "เขต/อำเภอ", example: "คลองเตย", help: "" },
    { header: "จังหวัด", example: "กรุงเทพมหานคร", help: "" },
    { header: "รหัสไปรษณีย์", example: "10110", help: "" },
    { header: "ประเทศ", example: "ไทย", help: "ว่าง = ไทย" },
    { header: "ที่อยู่จัดส่ง", example: "", help: "ที่อยู่จัดส่ง 1 แห่ง (ข้อความเต็ม)" },
    { header: "ผู้รับ", example: "", help: "ชื่อผู้รับของที่อยู่จัดส่ง" },
    { header: "เบอร์ผู้รับ", example: "", help: "" },
    ...CHANNEL_COLUMNS.map(([h]) => ({ header: h, example: h === "โทรศัพท์" ? "02-123-4567" : h === "อีเมล" ? "info@example.com" : "", help: "หลายค่าคั่นด้วย ," })),
    { header: "บุคคลติดต่อ", example: "คุณสมชาย ใจดี", help: "บุคคลติดต่อหลัก" },
    { header: "ตำแหน่ง", example: "ฝ่ายจัดซื้อ", help: "" },
    { header: "เบอร์บุคคลติดต่อ", example: "081-234-5678", help: "" },
    { header: "อีเมลบุคคลติดต่อ", example: "", help: "" },
    { header: "LINE บุคคลติดต่อ", example: "", help: "" },
    { header: "หมายเหตุ", example: "", help: "" },
  ],

  async plan(records) {
    const lookups = new LookupResolver();
    this.lookups = lookups;
    const errors: RowError[] = [];
    const rows: ImportPlan<ContactRow>["rows"] = [];
    const existingCodes = new Set((await prisma.contact.findMany({ select: { code: true } })).map((c) => c.code));
    const existingNames = new Set((await prisma.contact.findMany({ where: { deletedAt: null }, select: { name: true } })).map((c) => c.name.trim().toLowerCase()));
    const fileCodes = new Map<string, number>();
    const newTags = new Set<string>();
    const knownTags = new Set((await prisma.tag.findMany()).map((t) => t.name));

    for (const [i, r] of records.entries()) {
      const row = csvRow(i);
      const err = (column: string, message: string) => errors.push({ row, column, message });
      const isCustomer = parseBool(r["ลูกค้า"] ?? "", !r["ผู้ขาย"]);
      const isVendor = parseBool(r["ผู้ขาย"] ?? "", false);
      if (isCustomer === undefined) err("ลูกค้า", "ต้องเป็น ใช่/ไม่");
      if (isVendor === undefined) err("ผู้ขาย", "ต้องเป็น ใช่/ไม่");
      const et = (r["ประเภทกิจการ"] || "นิติบุคคล") as keyof typeof ENTITY;
      if (!(et in ENTITY)) err("ประเภทกิจการ", "ต้องเป็น นิติบุคคล หรือ บุคคลธรรมดา");

      const channels = CHANNEL_COLUMNS.flatMap(([h, type]) => splitList(r[h] ?? "").map((value) => ({ type, value })));
      const input: ContactInput = {
        code: r["รหัส"] || null,
        isCustomer: isCustomer ?? false,
        isVendor: isVendor ?? false,
        entityType: ENTITY[et] ?? "JURISTIC",
        name: r["ชื่อ"] ?? "",
        taxId: r["เลขประจำตัวผู้เสียภาษี"] || null,
        branch: r["สาขา"] || null,
        note: r["หมายเหตุ"] || null,
        reg: {
          address: r["ที่อยู่"],
          houseNo: r["เลขที่"],
          moo: r["หมู่"],
          soi: r["ซอย"],
          road: r["ถนน"],
          subdistrict: r["แขวง/ตำบล"],
          district: r["เขต/อำเภอ"],
          province: r["จังหวัด"],
          postalCode: r["รหัสไปรษณีย์"],
          country: r["ประเทศ"],
        },
        shippingAddresses: r["ที่อยู่จัดส่ง"] ? [{ address: r["ที่อยู่จัดส่ง"], recipient: r["ผู้รับ"] || null, phone: r["เบอร์ผู้รับ"] || null, isDefault: true }] : [],
        channels,
        persons: r["บุคคลติดต่อ"]
          ? [{ name: r["บุคคลติดต่อ"], position: r["ตำแหน่ง"] || null, phone: r["เบอร์บุคคลติดต่อ"] || null, email: r["อีเมลบุคคลติดต่อ"] || null, lineId: r["LINE บุคคลติดต่อ"] || null, isPrimary: true }]
          : [],
        tagIds: [],
      };
      const parsed = contactSchema.safeParse(input);
      if (!parsed.success) {
        for (const iss of parsed.error.issues) err(headerFor(iss.path, FIELD_HEADERS), iss.message);
        continue;
      }
      const code = parsed.data.code;
      if (code) {
        if (fileCodes.has(code)) {
          err("รหัส", `รหัส ${code} ซ้ำกับแถว ${fileCodes.get(code)}`);
          continue;
        }
        fileCodes.set(code, row);
      }
      const tags = splitList(r["กลุ่ม"] ?? "");
      tags.filter((t) => !knownTags.has(t)).forEach((t) => newTags.add(t));
      await lookups.note("CONTACT_SOURCE", r["ช่องทางที่รู้จัก"] ?? "");
      await lookups.note("CUSTOMER_BUSINESS_TYPE", r["ประเภทกิจการของลูกค้า"] ?? "");
      const data = { input, source: r["ช่องทางที่รู้จัก"] ?? "", businessType: r["ประเภทกิจการของลูกค้า"] ?? "", tags };
      if (code && existingCodes.has(code)) rows.push({ row, data, action: "skip", note: `มีรหัส ${code} อยู่แล้ว` });
      else if (!code && existingNames.has(parsed.data.name.toLowerCase())) rows.push({ row, data, action: "skip", note: `มีผู้ติดต่อชื่อ "${parsed.data.name}" อยู่แล้ว (ใส่รหัสถ้าต้องการนำเข้า)` });
      else rows.push({ row, data, action: "create" });
    }
    const notes = lookups.describe({ CONTACT_SOURCE: "ช่องทางที่รู้จัก", CUSTOMER_BUSINESS_TYPE: "ประเภทกิจการของลูกค้า" });
    if (newTags.size) notes.push(`จะสร้างกลุ่มใหม่ ${newTags.size} กลุ่ม: ${[...newTags].slice(0, 10).join(", ")}`);
    return { rows, errors, notes };
  },

  async commit(plan, ctx) {
    const lookups = this.lookups ?? new LookupResolver();
    let created = 0;
    for (const r of plan.rows.filter((x) => x.action === "create")) {
      const data: ContactData = contactSchema.parse({
        ...r.data.input,
        sourceId: await lookups.id(prisma, "CONTACT_SOURCE", r.data.source),
        customerBusinessTypeId: await lookups.id(prisma, "CUSTOMER_BUSINESS_TYPE", r.data.businessType),
        tagIds: await tagIds(r.data.tags),
      });
      try {
        await createContact(ctx.actor, data, null);
        created++;
      } catch (e) {
        throw new Error(`แถว ${r.row}: ${errorText(e)} (นำเข้าไปแล้ว ${created} ราย)`);
      }
    }
    return { created, skipped: plan.rows.length - created, notes: [] };
  },
};

// ───────────── บุคคลติดต่อเพิ่มเติม ─────────────

type PersonRow = { contactId: string; name: string; position: string | null; phone: string | null; email: string | null; lineId: string | null; note: string | null; isPrimary: boolean };

export const contactPersonsImporter: Importer<PersonRow> = {
  kind: "contact-persons",
  title: "บุคคลติดต่อเพิ่มเติม",
  description: "เพิ่มบุคคลติดต่อให้ผู้ติดต่อที่มีอยู่แล้ว (อ้างด้วยรหัสผู้ติดต่อ) — ชื่อซ้ำกับคนที่มีอยู่ในผู้ติดต่อเดียวกันจะข้าม",
  columns: [
    { header: "รหัสผู้ติดต่อ", required: true, example: "C0001", help: "รหัสผู้ติดต่อในระบบ (นำเข้าผู้ติดต่อก่อน)" },
    { header: "ชื่อ", required: true, example: "คุณวิภา รักงาน", help: "" },
    { header: "ตำแหน่ง", example: "ผู้จัดการ", help: "" },
    { header: "เบอร์โทร", example: "089-000-0000", help: "" },
    { header: "อีเมล", example: "", help: "" },
    { header: "LINE", example: "", help: "" },
    { header: "ผู้ติดต่อหลัก", example: "ไม่", help: "ใช่/ไม่" },
    { header: "หมายเหตุ", example: "", help: "" },
  ],

  async plan(records) {
    const errors: RowError[] = [];
    const rows: ImportPlan<PersonRow>["rows"] = [];
    const codes = [...new Set(records.map((r) => (r["รหัสผู้ติดต่อ"] ?? "").toUpperCase()).filter(Boolean))];
    const contacts = await prisma.contact.findMany({ where: { code: { in: codes }, deletedAt: null }, include: { persons: { select: { name: true } } } });
    const byCode = new Map(contacts.map((c) => [c.code, c]));
    const seen = new Set<string>();
    for (const [i, r] of records.entries()) {
      const row = csvRow(i);
      const code = (r["รหัสผู้ติดต่อ"] ?? "").toUpperCase();
      const name = r["ชื่อ"] ?? "";
      const c = byCode.get(code);
      const isPrimary = parseBool(r["ผู้ติดต่อหลัก"] ?? "", false);
      const email = r["อีเมล"] || null;
      if (!code) errors.push({ row, column: "รหัสผู้ติดต่อ", message: "กรุณากรอกรหัสผู้ติดต่อ" });
      else if (!c) errors.push({ row, column: "รหัสผู้ติดต่อ", message: `ไม่พบผู้ติดต่อรหัส ${code}` });
      if (!name) errors.push({ row, column: "ชื่อ", message: "กรุณากรอกชื่อ" });
      if (isPrimary === undefined) errors.push({ row, column: "ผู้ติดต่อหลัก", message: "ต้องเป็น ใช่/ไม่" });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ row, column: "อีเมล", message: "รูปแบบอีเมลไม่ถูกต้อง" });
      if (!c || !name || isPrimary === undefined) continue;
      const key = `${c.id}|${name.toLowerCase()}`;
      const data: PersonRow = { contactId: c.id, name, position: r["ตำแหน่ง"] || null, phone: r["เบอร์โทร"] || null, email, lineId: r["LINE"] || null, note: r["หมายเหตุ"] || null, isPrimary };
      if (seen.has(key) || c.persons.some((p) => p.name.toLowerCase() === name.toLowerCase())) rows.push({ row, data, action: "skip", note: `${code} มีบุคคลติดต่อ "${name}" อยู่แล้ว` });
      else rows.push({ row, data, action: "create" });
      seen.add(key);
    }
    return { rows, errors, notes: [] };
  },

  async commit(plan, ctx) {
    let created = 0;
    for (const r of plan.rows.filter((x) => x.action === "create")) {
      const { contactId, ...p } = r.data;
      await prisma.$transaction(async (tx) => {
        const max = await tx.contactPerson.aggregate({ where: { contactId }, _max: { sortOrder: true } });
        if (p.isPrimary) await tx.contactPerson.updateMany({ where: { contactId }, data: { isPrimary: false } });
        await tx.contactPerson.create({ data: { ...p, contactId, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
        await writeAudit(tx, { actorId: ctx.actor.id, entityType: ENTITY_CONTACT, entityId: contactId, action: "UPDATE", note: `นำเข้าบุคคลติดต่อ ${p.name} (${ctx.source})`, force: true });
      });
      created++;
    }
    return { created, skipped: plan.rows.length - created, notes: [] };
  },
};
