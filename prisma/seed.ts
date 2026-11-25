// Seed ข้อมูลเริ่มต้น (รันซ้ำได้ ไม่สร้างซ้ำ)
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { flagsToRow } from "../src/lib/rbac";
import { allocateDocNumber } from "../src/lib/doc-number";
import { planSerials } from "../src/lib/stock-rules";
import { postIssue, postReceipt, serialBalances } from "../src/lib/stock-ledger";
import type { TxClient } from "../src/lib/db";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const ALL = { view: true, create: true, edit: true, delete: true, cancel: true };
const ALL_APPROVE = { ...ALL, approve: true };
const VIEW = { view: true };

const SAMPLE_GROUPS: { name: string; description: string; permissions: Record<string, Partial<typeof ALL>> }[] = [
  {
    name: "จัดซื้อ",
    description: "ฝ่ายจัดซื้อ: ใบขอซื้อ ใบสั่งซื้อ ใบส่งคืน และดูผู้ขาย/สินค้า",
    permissions: {
      "contacts.vendor": ALL,
      "inventory.product": VIEW,
      "purchase.request": ALL_APPROVE,
      "purchase.order": ALL_APPROVE,
      "purchase.return": ALL_APPROVE,
      "inventory.receipt": { view: true },
      "settings.remark": ALL,
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
  {
    name: "ถอดแบบ/ติดตั้ง",
    description: "ฝ่ายถอดแบบ/ติดตั้ง: ใบถอดแบบ/ติดตั้ง (รวมสิทธิ์อนุมัติขั้น ตรวจสอบ/มอบหมาย/ตรวจรับงาน) และดูลูกค้า/สินค้า",
    permissions: {
      "engineer.document": ALL_APPROVE,
      "contacts.customer": VIEW,
      "inventory.product": VIEW,
    },
  },
  {
    name: "คลังสินค้า",
    description: "ฝ่ายคลัง: สินค้า นำเข้า นำออก",
    permissions: {
      "inventory.product": { view: true, create: true, edit: true },
      "inventory.receipt": ALL,
      "inventory.issue": ALL,
      "inventory.report": VIEW,
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
    PROJECT_WORK_STAGE: ["ออกแบบ", "ก่อสร้าง", "ตกแต่ง", "รีโนเวท/ซ่อมแซม"],
    PROJECT_WORK_NATURE: ["เทียบสเปค", "เสนอสเปค", "ประมูล", "ซื้อตรง"],
  } as const;
  for (const [kind, labels] of Object.entries(LOOKUPS) as [keyof typeof LOOKUPS, readonly string[]][]) {
    for (const [i, label] of labels.entries()) {
      await prisma.lookupOption.upsert({ where: { kind_label: { kind, label } }, update: {}, create: { kind, label, sortOrder: i } });
    }
  }
  console.log("✔ ตัวเลือกช่องทางที่รู้จัก / ประเภทกิจการของลูกค้า / ขั้นตอนและลักษณะงานของโครงการ");

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

  // ── เฟส 3: ตั้งค่าคลัง + สินค้า (สร้างเฉพาะครั้งแรก) ──
  const PRODUCT_TYPES = ["วัสดุไม้", "อุปกรณ์ติดตั้ง", "อื่นๆ"];
  for (const [i, label] of PRODUCT_TYPES.entries()) {
    await prisma.lookupOption.upsert({ where: { kind_label: { kind: "PRODUCT_TYPE", label } }, update: {}, create: { kind: "PRODUCT_TYPE", label, sortOrder: i } });
  }
  const UNITS = ["แผ่น", "เส้น", "ชิ้น", "กล่อง", "ม้วน", "ชุด", "เมตร", "ตร.ม."];
  for (const [i, name] of UNITS.entries()) await prisma.unit.upsert({ where: { name }, update: {}, create: { name, sortOrder: i } });
  console.log("✔ ประเภทสินค้า / หน่วย");

  // ───── จัดซื้อ (เฟส 5) ─────
  for (const [i, label] of ["สินค้าชำรุด", "ส่งผิดรุ่น/ผิดสเปก", "ส่งเกินจำนวน", "คุณภาพไม่ผ่านมาตรฐาน"].entries()) {
    await prisma.lookupOption.upsert({ where: { kind_label: { kind: "RETURN_REASON", label } }, update: {}, create: { kind: "RETURN_REASON", label, sortOrder: i } });
  }
  if ((await prisma.noteTemplate.count({ where: { module: "purchase" } })) === 0) {
    await prisma.noteTemplate.createMany({
      data: [
        { module: "purchase", sortOrder: 0, title: "เงื่อนไขการส่งของ", body: "กรุณาส่งสินค้าพร้อมใบส่งของ/ใบกำกับภาษี และแจ้งล่วงหน้าก่อนส่งอย่างน้อย 1 วัน" },
        { module: "purchase", sortOrder: 1, title: "การรับประกันสินค้า", body: "สินค้าต้องอยู่ในสภาพสมบูรณ์ หากพบสินค้าชำรุด บริษัทขอสงวนสิทธิ์ส่งคืนภายใน 7 วัน" },
      ],
    });
    console.log("✔ หมายเหตุสำเร็จรูป (จัดซื้อ) 2 รายการ");
  }
  console.log("✔ เหตุผลการส่งคืน");

  if ((await prisma.stockLocation.count()) === 0) {
    const wh = await prisma.stockLocation.create({ data: { level: 0, code: "WH1", name: "คลังหลัก" } });
    const zone = await prisma.stockLocation.create({ data: { parentId: wh.id, level: 1, code: "A", name: "โซน A" } });
    const shelf = await prisma.stockLocation.create({ data: { parentId: zone.id, level: 2, code: "A-1", name: "ชั้น 1" } });
    await prisma.stockLocation.create({ data: { parentId: shelf.id, level: 3, code: "A-1-01", name: "ช่อง 01" } });
    console.log("✔ คลังหลัก (WH1) > โซน A > ชั้น 1 > ช่อง 01");
  }

  if ((await prisma.productCategory.count()) === 0) {
    const tree: [string, [string, string[]][]][] = [
      ["พื้น", [["พื้นไม้คอมโพสิต", ["ลายไม้", "ผิวเรียบ"]]]],
      ["ผนัง", [["ผนังตกแต่ง", []]]],
      ["ระแนง", [["ระแนงภายนอก", []]]],
      ["อุปกรณ์", [["อุปกรณ์ยึด", ["คลิป", "สกรู"]]]],
    ];
    for (const [i, [l1, l2s]] of tree.entries()) {
      const c1 = await prisma.productCategory.create({ data: { level: 1, name: l1, sortOrder: i } });
      for (const [l2, l3s] of l2s) {
        const c2 = await prisma.productCategory.create({ data: { parentId: c1.id, level: 2, name: l2 } });
        for (const l3 of l3s) await prisma.productCategory.create({ data: { parentId: c2.id, level: 3, name: l3 } });
      }
    }
    console.log("✔ หมวดหมู่สินค้าตัวอย่าง");
  }

  if ((await prisma.productAttribute.count()) === 0) {
    await prisma.productAttribute.createMany({
      data: [
        { name: "ขนาด", dataType: "TEXT", sortOrder: 0 },
        { name: "ความยาว", dataType: "NUMBER", unitLabel: "มม.", sortOrder: 1 },
        { name: "สี", dataType: "SELECT", options: ["น้ำตาลเข้ม", "น้ำตาลอ่อน", "เทา", "ไม้สัก"], sortOrder: 2 },
      ],
    });
    console.log("✔ คุณสมบัติตัวอย่าง: ขนาด / ความยาว / สี");
  }

  if ((await prisma.product.count()) === 0) {
    const find = {
      type: async (label: string) => (await prisma.lookupOption.findUniqueOrThrow({ where: { kind_label: { kind: "PRODUCT_TYPE", label } } })).id,
      unit: async (name: string) => (await prisma.unit.findUniqueOrThrow({ where: { name } })).id,
      cat: async (name: string) => (await prisma.productCategory.findFirstOrThrow({ where: { name } })).id,
      attr: async (name: string) => (await prisma.productAttribute.findUniqueOrThrow({ where: { name } })).id,
    };
    await prisma.product.create({
      data: {
        code: "BW-DK-145-BR",
        name: "ไม้พื้นคอมโพสิต ลายไม้ 145 มม. สีน้ำตาลเข้ม",
        productTypeId: await find.type("วัสดุไม้"),
        categoryId: await find.cat("ลายไม้"),
        description: "ตัวอย่างสินค้า (แก้ไข/ลบได้)",
        stockUnitId: await find.unit("แผ่น"),
        attributeValues: {
          create: [
            { attributeId: await find.attr("ขนาด"), value: "145 x 21 มม." },
            { attributeId: await find.attr("ความยาว"), value: "2900" },
            { attributeId: await find.attr("สี"), value: "น้ำตาลเข้ม" },
          ],
        },
      },
    });
    await prisma.product.create({
      data: {
        code: "BW-CLIP-01",
        name: "คลิปยึดพื้น สแตนเลส",
        productTypeId: await find.type("อุปกรณ์ติดตั้ง"),
        categoryId: await find.cat("คลิป"),
        stockUnitId: await find.unit("กล่อง"),
      },
    });
    console.log("✔ สินค้าตัวอย่าง 2 รายการ");
  }

  // ใบนำเข้า/นำออกตัวอย่าง (เฉพาะเมื่อยังไม่มีเอกสารคลังเลย และมีข้อมูลตัวอย่างครบ)
  if ((await prisma.goodsReceipt.count()) === 0) {
    const [admin, deck, clip, bin] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.product.findFirst({ where: { code: "BW-DK-145-BR", deletedAt: null, isStockable: true } }),
      prisma.product.findFirst({ where: { code: "BW-CLIP-01", deletedAt: null, isStockable: true } }),
      prisma.stockLocation.findFirst({ where: { code: "A-1-01" }, include: { parent: { include: { parent: true } } } }),
    ]);
    const whId = bin?.parent?.parent?.parentId;
    if (admin && deck && clip && bin && whId) {
      await prisma.$transaction(async (t) => {
        const tx = t as unknown as TxClient;
        const docNo = await allocateDocNumber(tx, "GR");
        const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
        const r = await tx.goodsReceipt.create({
          data: { docNo, type: "OTHER", docDate: today, warehouseId: whId, lot: "LOT-SAMPLE", note: "ตัวอย่างจาก seed", createdById: admin.id },
        });
        let seq = 0;
        for (const [i, [product, count, qty]] of ([[deck, 5, 10], [clip, 2, 100]] as const).entries()) {
          const line = await tx.goodsReceiptLine.create({ data: { receiptId: r.id, lineNo: i + 1, productId: product.id, locationId: bin.id } });
          const plan = planSerials(docNo, seq, count);
          if (typeof plan === "string") throw new Error(plan);
          seq += count;
          await tx.stockSerial.createMany({
            data: plan.map((s) => ({ barcode: s.barcode, seq: s.seq, productId: product.id, receiptLineId: line.id, initialQty: qty, scannedAt: new Date(), scannedById: admin.id })),
          });
        }
        await postReceipt(tx, r.id, admin.id);
      });
      console.log("✔ ใบนำเข้าตัวอย่าง (5 SN × 10 แผ่น + 2 SN × 100 กล่อง)");
    }
  }

  // ใบนำออกตัวอย่าง: เบิกตัวอย่าง 3 แผ่นจาก SN แรกของใบนำเข้าตัวอย่าง (เฉพาะเมื่อยังไม่มีใบนำออกเลย)
  if ((await prisma.goodsIssue.count()) === 0) {
    const [admin, first] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.stockSerial.findFirst({
        where: { product: { code: "BW-DK-145-BR" }, receiptLine: { receipt: { note: "ตัวอย่างจาก seed", status: "POSTED" } } },
        orderBy: { seq: "asc" },
      }),
    ]);
    if (admin && first) {
      const done = await prisma.$transaction(async (t) => {
        const tx = t as unknown as TxClient;
        if (((await serialBalances(tx, [first.id])).get(first.id) ?? 0) < 3) return false;
        const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
        const gi = await tx.goodsIssue.create({
          data: { docNo: await allocateDocNumber(tx, "GI"), type: "SAMPLE", docDate: today, recipientName: "ลูกค้าตัวอย่าง", note: "ตัวอย่างจาก seed", createdById: admin.id },
        });
        await tx.goodsIssueLine.create({ data: { issueId: gi.id, lineNo: 1, serialId: first.id, productId: first.productId, quantity: 3 } });
        await postIssue(tx, gi.id, admin.id);
        return true;
      });
      if (done) console.log("✔ ใบนำออกตัวอย่าง (เบิกตัวอย่าง 3 แผ่น)");
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
