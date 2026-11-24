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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
