import { describe, expect, it } from "vitest";
import { balancesBy, checkIssueQuantities, MAX_SERIALS_PER_RECEIPT, parseQty, planSerials, serialBarcode, sumQty } from "@/lib/stock-rules";
import { generateSerialsSchema, issueSchema, receiptSchema } from "@/lib/validators";
import { displayToIso, isoToDisplay } from "@/lib/date-input";

describe("Barcode / SN", () => {
  it("รูปแบบ เลขที่ GR-ลำดับ 3 หลัก", () => {
    expect(serialBarcode("GR2611240001", 1)).toBe("GR2611240001-001");
    expect(serialBarcode("GR2611240001", 999)).toBe("GR2611240001-999");
    expect(() => serialBarcode("GR2611240001", 0)).toThrow();
    expect(() => serialBarcode("GR2611240001", 1000)).toThrow();
  });

  it("สร้างต่อจากลำดับล่าสุดของใบ (5 SN แล้วต่ออีก 1)", () => {
    const a = planSerials("GR1", 0, 5);
    expect(Array.isArray(a) && a.map((s) => s.barcode)).toEqual(["GR1-001", "GR1-002", "GR1-003", "GR1-004", "GR1-005"]);
    const b = planSerials("GR1", 5, 1);
    expect(Array.isArray(b) && b[0]).toEqual({ seq: 6, barcode: "GR1-006" });
  });

  it("ไม่เกิน 999 SN ต่อใบ และจำนวนต้องเป็นจำนวนเต็มบวก", () => {
    expect(planSerials("GR1", MAX_SERIALS_PER_RECEIPT - 2, 3)).toMatch(/เหลือได้อีก 2/);
    expect(planSerials("GR1", 0, 0)).toMatch(/จำนวนเต็ม/);
    expect(planSerials("GR1", 0, 1.5)).toMatch(/จำนวนเต็ม/);
  });
});

describe("จำนวน (ทศนิยม 3 ตำแหน่ง)", () => {
  it("parseQty", () => {
    expect(parseQty("1,250.5")).toBe(1250.5);
    expect(parseQty("0.125")).toBe(0.125);
    expect(parseQty("0.1255")).toBeNull();
    expect(parseQty("abc")).toBeNull();
    expect(parseQty(10)).toBe(10);
  });

  it("บวกไม่มีเศษ float", () => {
    expect(sumQty([0.1, 0.2])).toBe(0.3);
    expect(sumQty(["10", "2.555", -0.555])).toBe(12);
  });

  it("ยอดคงเหลือจาก movement (+/−) ตัดรายการที่เหลือ 0", () => {
    const m = balancesBy(
      [
        { s: "a", q: 10 },
        { s: "a", q: -3 },
        { s: "b", q: 5 },
        { s: "b", q: -5 },
      ],
      (r) => r.s,
      (r) => r.q,
    );
    expect(Object.fromEntries(m)).toEqual({ a: 7 });
  });
});

describe("นำออกห้ามเกินคงเหลือ", () => {
  const bal = new Map([
    ["sn1", 10],
    ["sn2", 0.5],
  ]);
  it("ผ่านเมื่อไม่เกิน", () => {
    expect(checkIssueQuantities([{ serialId: "sn1", quantity: 10 }, { serialId: "sn2", quantity: "0.5" }], bal)).toEqual({});
  });
  it("เกิน / SN ไม่มีคงเหลือ / จำนวน 0", () => {
    const e = checkIssueQuantities([{ serialId: "sn1", quantity: 10.001 }, { serialId: "sn3", quantity: 1 }], bal);
    expect(e.sn1).toMatch(/เกินคงเหลือ \(คงเหลือ 10\)/);
    expect(e.sn3).toMatch(/คงเหลือ 0/);
    expect(checkIssueQuantities([{ serialId: "sn1", quantity: 0 }], bal).sn1).toMatch(/มากกว่า 0/);
  });
});

describe("validators เฟส 4", () => {
  it("ใบนำเข้า: ต้องมีคลังและวันที่", () => {
    const r = receiptSchema.safeParse({ docDate: "", warehouseId: "", lines: [] });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toContain("docDate");
    expect(paths).toContain("warehouseId");
    expect(receiptSchema.parse({ docDate: "2026-11-24", warehouseId: "w", lines: [{ productId: "p" }] }).type).toBe("OTHER");
  });

  it("สร้าง SN: จำนวน SN จำนวนเต็ม, จำนวนต่อ SN ทศนิยมไม่เกิน 3 ตำแหน่ง", () => {
    expect(generateSerialsSchema.parse({ count: "5", qtyPerSerial: "10" })).toEqual({ count: 5, qtyPerSerial: 10 });
    expect(generateSerialsSchema.safeParse({ count: 2.5, qtyPerSerial: 1 }).success).toBe(false);
    expect(generateSerialsSchema.safeParse({ count: 1, qtyPerSerial: "1.2345" }).success).toBe(false);
    expect(generateSerialsSchema.safeParse({ count: 1, qtyPerSerial: 0 }).success).toBe(false);
  });

  it("ใบนำออก: ประเภทขายต้องมีลูกค้า, ห้าม SN ซ้ำ", () => {
    const base = { docDate: "2026-11-24", lines: [{ serialId: "s1", quantity: "2" }] };
    const sale = issueSchema.safeParse({ ...base, type: "SALE" });
    expect(sale.success).toBe(false);
    expect(sale.error!.issues[0].path).toEqual(["contactId"]);
    expect(issueSchema.safeParse({ ...base, type: "SAMPLE" }).success).toBe(true);
    const dup = issueSchema.safeParse({ ...base, type: "OTHER", lines: [...base.lines, { serialId: "s1", quantity: 1 }] });
    expect(dup.error!.issues[0].message).toMatch(/SN ซ้ำ/);
  });
});

describe("ช่องวันที่ DD/MM/YYYY", () => {
  it("แปลงไป-กลับ และปฏิเสธวันที่ไม่มีจริง", () => {
    expect(isoToDisplay("2026-11-24")).toBe("24/11/2026");
    expect(displayToIso("24/11/2026")).toBe("2026-11-24");
    expect(displayToIso("1/2/2026")).toBe("2026-02-01");
    expect(displayToIso("31/02/2026")).toBeNull();
    expect(displayToIso("2026-11-24")).toBeNull();
  });
});
