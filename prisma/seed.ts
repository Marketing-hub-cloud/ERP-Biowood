// Seed ข้อมูลเริ่มต้น (รันซ้ำได้ ไม่สร้างซ้ำ)
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { flagsToRow } from "../src/lib/rbac";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const ALL = { view: true, create: true, edit: true, delete: true, cancel: true };
const VIEW = { view: true };

const SAMPLE_GROUPS: { name: string; description: string; permissions: Record<string, Partial<typeof ALL>> }[] = [
  {
    name: "จัดซื้อ",
    description: "ฝ่ายจัดซื้อ: ใบขอซื้อ ใบสั่งซื้อ ใบส่งคืน และดูผู้ขาย/สินค้า",
    permissions: {
      "contacts.vendor": ALL,
      "inventory.product": VIEW,
      "purchase.request": ALL,
      "purchase.order": ALL,
      "purchase.return": ALL,
      "purchase.report": VIEW,
    },
  },
  {
    name: "ฝ่ายขาย",
    description: "ฝ่ายขาย: ลูกค้า โครงการ แผนการทำงาน",
    permissions: {
      "contacts.customer": ALL,
      "crm.project": ALL,
      "crm.plan": ALL,
      "crm.report": VIEW,
      "engineer.document": { view: true, create: true },
    },
  },
];

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@biowood.local").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8) throw new Error("กรุณาตั้ง SEED_ADMIN_PASSWORD ใน .env (อย่างน้อย 8 ตัวอักษร)");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const admin = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        firstName: "ผู้ดูแล",
        lastName: "ระบบ",
        department: "IT",
        position: "ผู้ดูแลระบบ",
        isAdmin: true,
      },
    });
    await prisma.auditLog.create({ data: { entityType: "User", entityId: admin.id, action: "CREATE", note: "seed", after: { email, isAdmin: true } } });
    console.log(`✔ สร้างผู้ดูแลระบบ ${email}`);
  } else {
    console.log(`• มีผู้ใช้ ${email} อยู่แล้ว (ไม่เปลี่ยนรหัสผ่าน)`);
  }

  for (const g of SAMPLE_GROUPS) {
    const exists = await prisma.permissionGroup.findUnique({ where: { name: g.name } });
    if (exists) continue;
    await prisma.permissionGroup.create({
      data: {
        name: g.name,
        description: g.description,
        permissions: { create: Object.entries(g.permissions).map(([k, f]) => flagsToRow(k, f)) },
      },
    });
    console.log(`✔ สร้างกลุ่มสิทธิ์ ${g.name}`);
  }

  await prisma.companySetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, nameTh: "บริษัท ไบโอวูด จำกัด", nameEn: "Biowood Co., Ltd.", branch: "สำนักงานใหญ่" },
  });
  console.log("✔ ข้อมูลบริษัทเริ่มต้น (แก้ได้ที่ ตั้งค่า > ข้อมูลบริษัท)");

  // ── เฟส 2: ตัวเลือกผู้ติดต่อ ──
  const LOOKUPS = {
    CONTACT_SOURCE: ["Facebook", "Google", "LINE", "แนะนำต่อ", "งานแสดงสินค้า", "หน้าร้าน"],
    CUSTOMER_BUSINESS_TYPE: ["บ้านส่วนตัว", "คอนโด", "โรงแรม/รีสอร์ท", "อาคารพาณิชย์", "ผู้รับเหมา", "สถาปนิก/ผู้ออกแบบ"],
  } as const;
  for (const [kind, labels] of Object.entries(LOOKUPS) as [keyof typeof LOOKUPS, readonly string[]][]) {
    for (const [i, label] of labels.entries()) {
      await prisma.lookupOption.upsert({ where: { kind_label: { kind, label } }, update: {}, create: { kind, label, sortOrder: i } });
    }
  }
  console.log("✔ ตัวเลือกช่องทางที่รู้จัก / ประเภทกิจการของลูกค้า");

  // ผู้ติดต่อตัวอย่าง (สร้างเฉพาะครั้งแรก)
  if ((await prisma.contact.count()) === 0) {
    const lookup = async (kind: keyof typeof LOOKUPS, label: string) =>
      (await prisma.lookupOption.findUniqueOrThrow({ where: { kind_label: { kind, label } } })).id;
    const tag = async (name: string) => (await prisma.tag.upsert({ where: { name }, update: {}, create: { name } })).id;
    const samples = [
      {
        code: "CT00001",
        isCustomer: true,
        entityType: "INDIVIDUAL" as const,
        name: "คุณสมศรี ตัวอย่าง",
        sourceId: await lookup("CONTACT_SOURCE", "Facebook"),
        customerBusinessTypeId: await lookup("CUSTOMER_BUSINESS_TYPE", "บ้านส่วนตัว"),
        regProvince: "นนทบุรี",
        channels: { create: [{ type: "MOBILE" as const, value: "081-234-5678" }, { type: "LINE" as const, value: "somsri.demo", sortOrder: 1 }] },
        tags: { create: [{ tagId: await tag("ลูกค้ารายย่อย") }] },
      },
      {
        code: "CT00002",
        isCustomer: true,
        isVendor: true,
        entityType: "JURISTIC" as const,
        name: "บริษัท ตัวอย่างก่อสร้าง จำกัด",
        taxId: "0105500000001",
        branch: "สำนักงานใหญ่",
        sourceId: await lookup("CONTACT_SOURCE", "แนะนำต่อ"),
        customerBusinessTypeId: await lookup("CUSTOMER_BUSINESS_TYPE", "ผู้รับเหมา"),
        regHouseNo: "99/9",
        regRoad: "บางนา-ตราด",
        regSubdistrict: "บางนาใต้",
        regDistrict: "บางนา",
        regProvince: "กรุงเทพมหานคร",
        regPostalCode: "10260",
        channels: { create: [{ type: "PHONE" as const, value: "02-000-0000" }, { type: "EMAIL" as const, value: "contact@example.com", sortOrder: 1 }] },
        persons: { create: [{ name: "คุณวิชัย", position: "ผู้จัดการโครงการ", phone: "089-000-0000", isPrimary: true }] },
        tags: { create: [{ tagId: await tag("ผู้รับเหมา") }] },
      },
      {
        code: "CT00003",
        isVendor: true,
        entityType: "JURISTIC" as const,
        name: "บริษัท ตัวอย่างวัสดุ จำกัด",
        taxId: "0105500000002",
        branch: "สำนักงานใหญ่",
        regProvince: "สมุทรปราการ",
        channels: { create: [{ type: "PHONE" as const, value: "02-111-1111" }] },
        persons: { create: [{ name: "คุณนภา", position: "ฝ่ายขาย", email: "sales@example.com", isPrimary: true }] },
      },
    ];
    for (const s of samples) await prisma.contact.create({ data: s });
    // ให้รหัสอัตโนมัติถัดไปเริ่มที่ CT00004
    await prisma.documentCounter.upsert({
      where: { prefix_dateKey: { prefix: "CT", dateKey: "" } },
      update: {},
      create: { prefix: "CT", dateKey: "", lastSeq: samples.length },
    });
    console.log(`✔ ผู้ติดต่อตัวอย่าง ${samples.length} ราย`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
