// เทส stock ledger กับฐานข้อมูลจริง: นำออกพร้อมกันต้องไม่ติดลบ (เกณฑ์ตรวจรับ), ยกเลิก/กลับรายการ, append-only
// สร้างเอกสารด้วยเลขที่ "ZT..." เอง (ไม่ใช้ตัวนับจริง) และลบทุกอย่างทิ้งตอนจบ
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cancelIssue, cancelReceipt, postIssue, postReceipt, serialBalances } from "@/lib/stock-ledger";

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = `ZT${Date.now().toString(36).toUpperCase()}`;
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

let actorId = "";
let warehouseId = "";
let productId = "";
let issueSeq = 0;

async function newReceipt(qtys: number[]) {
  const r = await prisma.goodsReceipt.create({
    data: { docNo: `${TAG}-GR${qtys.length}${Math.random().toString(36).slice(2, 6)}`, docDate: today, warehouseId, createdById: actorId },
  });
  const line = await prisma.goodsReceiptLine.create({ data: { receiptId: r.id, lineNo: 1, productId, locationId: warehouseId } });
  await prisma.stockSerial.createMany({
    data: qtys.map((q, i) => ({ barcode: `${r.docNo}-${String(i + 1).padStart(3, "0")}`, seq: i + 1, productId, receiptLineId: line.id, initialQty: q, scannedAt: new Date() })),
  });
  const serials = await prisma.stockSerial.findMany({ where: { receiptLineId: line.id }, orderBy: { seq: "asc" } });
  return { receipt: r, serials };
}

async function newIssue(serialId: string, quantity: number) {
  return prisma.goodsIssue.create({
    data: {
      docNo: `${TAG}-GI${++issueSeq}`,
      type: "OTHER",
      docDate: today,
      createdById: actorId,
      lines: { create: [{ lineNo: 1, serialId, productId, quantity }] },
    },
  });
}

const balance = async (serialId: string) => (await prisma.$transaction((tx) => serialBalances(tx, [serialId]))).get(serialId) ?? 0;

describe.skipIf(!hasDb)("stock ledger (DB)", () => {
  beforeAll(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { isAdmin: true } });
    actorId = admin.id;
    const wh = await prisma.stockLocation.create({ data: { level: 0, code: TAG, name: `คลังเทส ${TAG}` } });
    warehouseId = wh.id;
    const unit = await prisma.unit.findFirstOrThrow();
    const p = await prisma.product.create({ data: { code: `${TAG}-P`, name: `สินค้าเทส ${TAG}`, stockUnitId: unit.id } });
    productId = p.id;
  });

  afterAll(async () => {
    if (!productId) return;
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.goodsIssue.deleteMany({ where: { docNo: { startsWith: TAG } } });
    await prisma.stockSerial.deleteMany({ where: { productId } });
    await prisma.goodsReceipt.deleteMany({ where: { docNo: { startsWith: TAG } } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.stockLocation.delete({ where: { id: warehouseId } });
    await prisma.$disconnect();
  });

  it("นำเข้า: ต้องสแกนครบ แล้วยอดเพิ่มตาม SN", async () => {
    const { receipt, serials } = await newReceipt([10, 10]);
    await prisma.stockSerial.update({ where: { id: serials[1].id }, data: { scannedAt: null } });
    await expect(prisma.$transaction((tx) => postReceipt(tx, receipt.id, actorId))).rejects.toThrow(/ยังไม่ได้สแกนอีก 1 SN/);
    await prisma.stockSerial.update({ where: { id: serials[1].id }, data: { scannedAt: new Date() } });
    await prisma.$transaction((tx) => postReceipt(tx, receipt.id, actorId));
    expect(await balance(serials[0].id)).toBe(10);
    expect(await balance(serials[1].id)).toBe(10);
    // กดนำเข้าซ้ำไม่ได้ (ไม่เพิ่มยอดซ้ำ)
    await expect(prisma.$transaction((tx) => postReceipt(tx, receipt.id, actorId))).rejects.toThrow(/บันทึกเข้าคลังแล้ว/);
    expect(await balance(serials[0].id)).toBe(10);
  });

  it("นำออกพร้อมกัน 2 ใบ (6 + 6 จากคงเหลือ 10): สำเร็จใบเดียว ยอดไม่ติดลบ", async () => {
    const { receipt, serials } = await newReceipt([10]);
    await prisma.$transaction((tx) => postReceipt(tx, receipt.id, actorId));
    const [a, b] = await Promise.all([newIssue(serials[0].id, 6), newIssue(serials[0].id, 6)]);
    const results = await Promise.allSettled([a, b].map((d) => prisma.$transaction((tx) => postIssue(tx, d.id, actorId))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason.message)).toMatch(/เกินคงเหลือ \(คงเหลือ 4\)/);
    expect(await balance(serials[0].id)).toBe(4);
  });

  it("นำออกพร้อมกัน 6 ใบ ใบละ 1 จากคงเหลือ 4: สำเร็จ 4 ใบพอดี", async () => {
    const { receipt, serials } = await newReceipt([4]);
    await prisma.$transaction((tx) => postReceipt(tx, receipt.id, actorId));
    const docs = await Promise.all(Array.from({ length: 6 }, () => newIssue(serials[0].id, 1)));
    const results = await Promise.allSettled(docs.map((d) => prisma.$transaction((tx) => postIssue(tx, d.id, actorId))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(await balance(serials[0].id)).toBe(0);
  });

  it("ยกเลิก: GR ที่มีการนำออกแล้วยกเลิกไม่ได้ → ยกเลิก GI ก่อน (ยอดคืน) → ยกเลิก GR ได้ (ยอดเป็น 0)", async () => {
    const { receipt, serials } = await newReceipt([10]);
    await prisma.$transaction((tx) => postReceipt(tx, receipt.id, actorId));
    const gi = await newIssue(serials[0].id, 3.5);
    await prisma.$transaction((tx) => postIssue(tx, gi.id, actorId));
    expect(await balance(serials[0].id)).toBe(6.5);

    await expect(prisma.$transaction((tx) => cancelReceipt(tx, receipt.id, actorId, "ทดสอบ"))).rejects.toThrow(/ถูกนำออกไปแล้ว 1 SN/);
    await prisma.$transaction((tx) => cancelIssue(tx, gi.id, actorId, "ทดสอบ"));
    expect(await balance(serials[0].id)).toBe(10);
    await prisma.$transaction((tx) => cancelReceipt(tx, receipt.id, actorId, "ทดสอบ"));
    expect(await balance(serials[0].id)).toBe(0);

    const types = (await prisma.stockMovement.findMany({ where: { serialId: serials[0].id }, orderBy: { createdAt: "asc" } })).map((m) => m.type);
    expect(types).toEqual(["RECEIPT", "ISSUE", "ISSUE_REVERSAL", "RECEIPT_REVERSAL"]);
    // ยกเลิกซ้ำไม่ได้
    await expect(prisma.$transaction((tx) => cancelIssue(tx, gi.id, actorId, "ซ้ำ"))).rejects.toThrow(/ถูกยกเลิกแล้ว/);
  });

  it("stock_movements แก้ไขไม่ได้ (append-only)", async () => {
    const m = await prisma.stockMovement.findFirstOrThrow({ where: { productId } });
    await expect(prisma.stockMovement.update({ where: { id: m.id }, data: { quantity: 999 } })).rejects.toThrow(/append-only/);
  });
});
