// เทสกับฐานข้อมูลจริง (ต้องตั้ง DATABASE_URL และรัน migration แล้ว)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { allocateDocNumber, dateKey, previewDocNumber } from "@/lib/doc-number";

const PREFIX = "ZT"; // prefix สำหรับเทสเท่านั้น
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("เลขที่เอกสาร (DB)", () => {
  beforeAll(async () => {
    await prisma.documentCounter.deleteMany({ where: { prefix: PREFIX } });
  });
  afterAll(async () => {
    await prisma.documentCounter.deleteMany({ where: { prefix: PREFIX } });
    await prisma.$disconnect();
  });

  it("สร้างพร้อมกัน 20 ใบ เลขที่ไม่ซ้ำและต่อเนื่อง", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => prisma.$transaction((tx) => allocateDocNumber(tx, PREFIX))),
    );
    expect(new Set(numbers).size).toBe(20);
    const key = dateKey();
    const expected = Array.from({ length: 20 }, (_, i) => `${PREFIX}${key}${String(i + 1).padStart(4, "0")}`);
    expect([...numbers].sort()).toEqual(expected);
  });

  it("preview ไม่จองเลข", async () => {
    const p1 = await previewDocNumber(prisma, PREFIX);
    const p2 = await previewDocNumber(prisma, PREFIX);
    expect(p1).toBe(p2);
    const real = await prisma.$transaction((tx) => allocateDocNumber(tx, PREFIX));
    expect(real).toBe(p1);
  });

  it("transaction ที่ rollback จะไม่กินเลข", async () => {
    const before = await previewDocNumber(prisma, PREFIX);
    await expect(
      prisma.$transaction(async (tx) => {
        await allocateDocNumber(tx, PREFIX);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await previewDocNumber(prisma, PREFIX)).toBe(before);
  });

  it("วันใหม่เริ่มนับ 0001", async () => {
    const n = await prisma.$transaction((tx) => allocateDocNumber(tx, PREFIX, new Date("2020-01-01T05:00:00Z")));
    expect(n).toBe(`${PREFIX}2001010001`);
  });
});
