// สคริปต์ import ข้อมูลเก่ากับฐานข้อมูลจริง: ผู้ติดต่อ → บุคคลติดต่อ → สินค้า → โครงการ → ยอดยกมา
// ข้อมูลมี tag "ZI…" ลบทิ้งตอนจบ
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { adminPermissions } from "@/lib/rbac";
import type { CurrentUser } from "@/lib/session";
import { findImporter, runImport, templateCsv, IMPORTERS } from "@/server/import";
import { csvToRecords } from "@/lib/csv-parse";
import { findReport } from "@/server/reports";

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = `ZI${Date.now().toString(36).toUpperCase()}`;
const csv = (lines: string[]) => "﻿" + lines.join("\r\n") + "\r\n";

let actor: CurrentUser;
let ctx: { actor: CurrentUser; source: string; date: string };
let whId = "";
let attrId = "";

const run = (kind: string, text: string, commit: boolean) => runImport(findImporter(kind)!, text, ctx, commit);

describe.skipIf(!hasDb)("import ข้อมูลเก่า (DB)", () => {
  beforeAll(async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { isAdmin: true, status: "ACTIVE" } });
    actor = { ...u, isAdmin: true, permissions: adminPermissions() };
    ctx = { actor, source: `${TAG}.csv`, date: "2026-01-01" };
    const wh = await prisma.stockLocation.create({ data: { level: 0, code: `${TAG}W`, name: `คลัง ${TAG}` } });
    whId = wh.id;
    const z = await prisma.stockLocation.create({ data: { parentId: wh.id, level: 1, code: "A", name: "โซน A" } });
    await prisma.stockLocation.create({ data: { parentId: z.id, level: 2, code: "A-1", name: "ชั้น 1" } });
    attrId = (await prisma.productAttribute.create({ data: { name: `สี${TAG}`, dataType: "SELECT", options: ["เทา", "น้ำตาล"] } })).id;
  });

  afterAll(async () => {
    if (!whId) return;
    const grs = (await prisma.goodsReceipt.findMany({ where: { warehouseId: whId }, select: { id: true } })).map((g) => g.id);
    const products = (await prisma.product.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id);
    const contacts = (await prisma.contact.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id);
    const projects = (await prisma.project.findMany({ where: { customerId: { in: contacts } }, select: { id: true } })).map((p) => p.id);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...grs, ...products, ...contacts, ...projects] } } });
    await prisma.stockMovement.deleteMany({ where: { warehouseId: whId } });
    await prisma.stockSerial.deleteMany({ where: { productId: { in: products } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: grs } } });
    await prisma.project.deleteMany({ where: { id: { in: projects } } });
    await prisma.product.deleteMany({ where: { id: { in: products } } });
    await prisma.contact.deleteMany({ where: { id: { in: contacts } } });
    await prisma.productAttribute.delete({ where: { id: attrId } });
    await prisma.lookupOption.deleteMany({ where: { label: { contains: TAG } } });
    await prisma.tag.deleteMany({ where: { name: { contains: TAG } } });
    await prisma.unit.deleteMany({ where: { name: { contains: TAG } } });
    for (const level of [3, 2, 1]) await prisma.productCategory.deleteMany({ where: { name: { contains: TAG }, level } });
    await prisma.stockLocation.deleteMany({ where: { parentId: { not: null }, code: "A-1", parent: { parentId: whId } } });
    await prisma.stockLocation.deleteMany({ where: { parentId: whId } });
    await prisma.stockLocation.delete({ where: { id: whId } });
    await prisma.$disconnect();
  });

  it("แม่แบบทุกชนิดอ่านกลับได้ และหัวตารางตรงกับคอลัมน์", () => {
    for (const imp of IMPORTERS) {
      const { headers, records } = csvToRecords(templateCsv(imp));
      expect(headers).toEqual(imp.columns.map((c) => c.header));
      expect(records).toHaveLength(1);
    }
  });

  it("ผู้ติดต่อ: dry run ไม่เขียน DB, error แจ้งแถว/คอลัมน์, มี error = ไม่นำเข้าเลย", async () => {
    const bad = csv([
      "รหัส,ชื่อ,ลูกค้า,ผู้ขาย,เลขประจำตัวผู้เสียภาษี,อีเมล,คอลัมน์แปลก",
      `${TAG}1,ลูกค้าหนึ่ง,ใช่,,,,`,
    ]);
    const r0 = await run("contacts", bad, true);
    expect(r0.plan.errors[0]).toMatchObject({ row: 1, column: "คอลัมน์แปลก" });
    expect(r0.result).toBeNull();

    const text = csv([
      "รหัส,ชื่อ,ลูกค้า,ผู้ขาย,ประเภทกิจการ,เลขประจำตัวผู้เสียภาษี,ช่องทางที่รู้จัก,กลุ่ม,จังหวัด,ที่อยู่จัดส่ง,โทรศัพท์,อีเมล,บุคคลติดต่อ,ตำแหน่ง",
      `${TAG}1,ลูกค้าหนึ่ง ${TAG},ใช่,,บุคคลธรรมดา,,แหล่ง${TAG},VIP${TAG},กรุงเทพมหานคร,"99 ถนนทดสอบ, กทม.","02-111-1111, 081-222-2222",a@example.com,คุณเอ,เจ้าของ`,
      `${TAG}2,ผู้ขายสอง ${TAG},ไม่,ใช่,,0105551234567,,,,,,,,`,
      `${TAG}3,ผิด ${TAG},ไม่,ไม่,,12345,,,,,,ไม่ใช่อีเมล,,`,
    ]);
    const dry = await run("contacts", text, false);
    expect(dry.summary).toMatchObject({ total: 3, create: 2, errors: 3 });
    const rows = dry.plan.errors.map((e) => e.row);
    expect(new Set(rows)).toEqual(new Set([4]));
    expect(dry.plan.errors.map((e) => e.message).join(" ")).toMatch(/13 หลัก/);
    expect(dry.plan.notes.join(" ")).toMatch(new RegExp(`แหล่ง${TAG}`));

    const ok = await run("contacts", text.replace(/\r\n[^\r\n]*ผิด [^\r\n]*/, ""), true);
    expect(ok.result).toMatchObject({ created: 2 });
    const c1 = await prisma.contact.findUniqueOrThrow({ where: { code: `${TAG}1` }, include: { channels: true, persons: true, shippingAddresses: true, tags: { include: { tag: true } }, source: true } });
    expect(c1).toMatchObject({ isCustomer: true, isVendor: false, entityType: "INDIVIDUAL", regProvince: "กรุงเทพมหานคร" });
    expect(c1.channels.map((c) => c.value).sort()).toEqual(["02-111-1111", "081-222-2222", "a@example.com"]);
    expect(c1.persons[0]).toMatchObject({ name: "คุณเอ", isPrimary: true });
    expect(c1.shippingAddresses[0].address).toBe("99 ถนนทดสอบ, กทม.");
    expect(c1.tags[0].tag.name).toBe(`VIP${TAG}`);
    expect(c1.source?.label).toBe(`แหล่ง${TAG}`);
    expect(await prisma.auditLog.count({ where: { entityId: c1.id, action: "CREATE" } })).toBe(1);

    // รันซ้ำ: ข้ามทั้งหมด
    const again = await run("contacts", text.replace(/\r\n[^\r\n]*ผิด [^\r\n]*/, ""), true);
    expect(again.summary).toMatchObject({ create: 0, skip: 2 });
  });

  it("บุคคลติดต่อเพิ่มเติม: เพิ่มให้ผู้ติดต่อเดิม ชื่อซ้ำข้าม", async () => {
    const r = await run(
      "contact-persons",
      csv(["รหัสผู้ติดต่อ,ชื่อ,ตำแหน่ง,ผู้ติดต่อหลัก", `${TAG}1,คุณบี,บัญชี,ใช่`, `${TAG}1,คุณเอ,,`, `NOPE${TAG},คุณซี,,`]),
      false,
    );
    expect(r.plan.errors).toEqual([expect.objectContaining({ row: 4, column: "รหัสผู้ติดต่อ" })]);
    const ok = await run("contact-persons", csv(["รหัสผู้ติดต่อ,ชื่อ,ตำแหน่ง,ผู้ติดต่อหลัก", `${TAG}1,คุณบี,บัญชี,ใช่`, `${TAG}1,คุณเอ,,`]), true);
    expect(ok.result).toMatchObject({ created: 1, skipped: 1 });
    const persons = await prisma.contactPerson.findMany({ where: { contact: { code: `${TAG}1` } }, orderBy: { sortOrder: "asc" } });
    expect(persons.map((p) => [p.name, p.isPrimary])).toEqual([
      ["คุณเอ", false],
      ["คุณบี", true],
    ]);
  });

  it("สินค้า: สร้างหน่วย/หมวดหมู่/ประเภทใหม่ + คุณสมบัติ (คอลัมน์ตามชื่อคุณสมบัติ)", async () => {
    const head = `รหัสสินค้า,ชื่อสินค้า,ประเภทสินค้า,หมวดหมู่,หน่วย,สต๊อกได้,สี${TAG}`;
    const bad = await run("products", csv([head, `${TAG}-x,ไม่มีหน่วย,,,,ใช่,`, `${TAG}-Y,สีผิด,,,แผ่น${TAG},,ม่วง`]), false);
    expect(bad.plan.errors.map((e) => [e.row, e.column])).toEqual([
      [2, "หน่วย"],
      [3, `สี${TAG}`],
    ]);
    const ok = await run(
      "products",
      csv([head, `${TAG}-deck,ไม้พื้น ${TAG},วัสดุ${TAG},พื้น${TAG} > คอมโพสิต${TAG} > ลาย${TAG},แผ่น${TAG},,เทา`, `${TAG}-SVC,ค่าติดตั้ง ${TAG},,,,ไม่,`]),
      true,
    );
    expect(ok.result).toMatchObject({ created: 2 });
    const p = await prisma.product.findUniqueOrThrow({ where: { code: `${TAG}-DECK` }, include: { stockUnit: true, category: true, productType: true, attributeValues: true } });
    expect(p.stockUnit?.name).toBe(`แผ่น${TAG}`);
    expect(p.category).toMatchObject({ name: `ลาย${TAG}`, level: 3 });
    expect(p.productType?.label).toBe(`วัสดุ${TAG}`);
    expect(p.attributeValues).toEqual([expect.objectContaining({ attributeId: attrId, value: "เทา" })]);
  });

  it("โครงการ: อ้างรหัสลูกค้า, สถานะภาษาไทย, วันที่ พ.ศ., มูลค่ามี comma", async () => {
    const head = "ชื่อโครงการ,รหัสลูกค้า,สถานะ,% โอกาสสำเร็จ,วันคาดการณ์ปิดดีล,มูลค่า,ขั้นตอนของงาน,วันสิ้นสุดรับประกัน";
    const bad = await run("projects", csv([head, `โครงการ ${TAG},${TAG}2,เสนอราคา,,,,,`, `โครงการ ${TAG},${TAG}1,ไม่รู้,15,32/01/2026,abc,,`]), false);
    const msgs = bad.plan.errors.map((e) => `${e.row}:${e.column}`);
    expect(msgs).toEqual(expect.arrayContaining(["2:รหัสลูกค้า", "3:สถานะ", "3:วันคาดการณ์ปิดดีล", "3:มูลค่า"]));
    const ok = await run("projects", csv([head, `บ้าน ${TAG},${TAG}1,เสนอราคา,50%,31/12/2569,"192,085",ก่อสร้าง${TAG},01/01/2570`]), true);
    expect(ok.result).toMatchObject({ created: 1 });
    const pj = await prisma.project.findFirstOrThrow({ where: { name: `บ้าน ${TAG}` }, include: { workStage: true } });
    expect(pj).toMatchObject({ status: "QUOTED", probability: 50 });
    expect(pj.value?.toString()).toBe("192085");
    expect(pj.expectedCloseDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(pj.warrantyEnd?.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(pj.workStage?.label).toBe(`ก่อสร้าง${TAG}`);
  });

  it("ยอดยกมา: ใบนำเข้านำเข้าแล้ว แยก Lot, แบ่ง SN, วันที่มีผลตามวันตัดยอด, นำเข้าซ้ำไม่ได้", async () => {
    const head = "รหัสสินค้า,รหัสคลัง,สถานที่,Lot,จำนวน,จำนวนต่อ SN";
    const bad = await run(
      "opening-stock",
      csv([head, `${TAG}-SVC,${TAG}W,,,1,`, `${TAG}-DECK,NOPE,,,1,`, `${TAG}-DECK,${TAG}W,ZZ,,1,`, `${TAG}-DECK,${TAG}W,,,0,`]),
      false,
    );
    expect(bad.plan.errors.map((e) => `${e.row}:${e.column}`)).toEqual(["2:รหัสสินค้า", "3:รหัสคลัง", "4:สถานที่", "5:จำนวน"]);

    const ok = await run("opening-stock", csv([head, `${TAG}-DECK,${TAG}W,A-1,L1,25,10`, `${TAG}-DECK,${TAG}W,A > A-1,L2,7,`, `${TAG}-deck,${TAG}w,,L1,3,`]), true);
    expect(ok.summary.errors).toBe(0);
    const grs = await prisma.goodsReceipt.findMany({ where: { warehouseId: whId }, include: { lines: { include: { serials: true } } }, orderBy: { lot: "asc" } });
    expect(grs.map((g) => [g.lot, g.status, g.docDate.toISOString().slice(0, 10)])).toEqual([
      ["L1", "POSTED", "2026-01-01"],
      ["L2", "POSTED", "2026-01-01"],
    ]);
    expect(grs[0].lines.map((l) => l.serials.map((s) => Number(s.initialQty)))).toEqual([[10, 10, 5], [3]]);
    expect(grs[0].note).toContain(`${TAG}.csv`);

    const productId = grs[0].lines[0].productId;
    const sum = await prisma.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } });
    expect(Number(sum._sum.quantity)).toBe(35);
    // ยอด ณ วันตัดยอด (01/01/2026) เห็นแล้ว แต่ ณ วันก่อนหน้ายังไม่มี
    const onHand = findReport("inventory", "on-hand")!;
    const at = async (asOf: string) => (await onHand.run({ asOf, warehouse: whId, view: "product" }, actor)).rows.find((r) => r.code === `${TAG}-DECK`)?.qty;
    expect(await at("2026-01-01")).toBe(35);
    expect(await at("2025-12-31")).toBeUndefined();

    // นำเข้าซ้ำไม่ได้ (สินค้ามีความเคลื่อนไหวแล้ว)
    const again = await run("opening-stock", csv([head, `${TAG}-DECK,${TAG}W,,,1,`]), true);
    expect(again.result).toBeNull();
    expect(again.plan.errors[0].message).toMatch(/มีความเคลื่อนไหวในคลังแล้ว/);
  });
});
