import { describe, expect, it } from "vitest";
import { ancestry, checkPlacement, descendantIds, flattenTree, pathLabel, relevel, subtreeDepth, type TreeNode } from "@/lib/tree";
import { normalizeAttributeValue, validateAttributeValues, type AttributeDef } from "@/lib/product-rules";
import { attributeSchema, productSchema, treeNodeSchema } from "@/lib/validators";

const node = (id: string, parentId: string | null, level: number, name = id): TreeNode => ({ id, parentId, level, code: id.toUpperCase(), name, isActive: true, sortOrder: 0 });

// คลัง WH (0) > A (1) > A1 (2) > A1x (3); WH2 (0) > B (1)
const LOC = [node("wh", null, 0), node("a", "wh", 1), node("a1", "a", 2), node("a1x", "a1", 3), node("wh2", null, 0), node("b", "wh2", 1)];

describe("tree", () => {
  it("descendantIds / subtreeDepth / ancestry / pathLabel", () => {
    expect(descendantIds(LOC, "a").sort()).toEqual(["a", "a1", "a1x"]);
    expect(subtreeDepth(LOC, "a")).toBe(2);
    expect(subtreeDepth(LOC, "a1x")).toBe(0);
    expect(ancestry(LOC, "a1x").map((n) => n.id)).toEqual(["wh", "a", "a1", "a1x"]);
    expect(pathLabel(LOC, "a1")).toBe("wh > a > a1");
  });

  it("สถานที่: คลัง (0) + ซ้อนได้อีก 3 ระดับ แต่ระดับที่ 5 ไม่ได้", () => {
    expect(checkPlacement("locations", LOC, null, null)).toBeNull(); // คลังใหม่
    expect(checkPlacement("locations", LOC, "a1", null)).toBeNull(); // ระดับ 3
    expect(checkPlacement("locations", LOC, "a1x", null)).toMatch(/ลึกสุด/); // ระดับ 4 → ไม่ได้
  });

  it("ย้าย: ห้ามไปอยู่ใต้ตัวเอง/ลูกหลาน และห้ามลึกเกินเมื่อรวม subtree", () => {
    expect(checkPlacement("locations", LOC, "a1", "a")).toMatch(/ใต้ตัวเอง/);
    expect(checkPlacement("locations", LOC, "a", "a")).toMatch(/ใต้ตัวเอง/);
    // ย้าย A (มีลูก 2 ระดับ) ไปใต้ B (ระดับ 1) → A ระดับ 2, ลูกลึกสุดระดับ 4 → ไม่ได้
    expect(checkPlacement("locations", LOC, "b", "a")).toMatch(/ลึกสุด/);
    // ย้าย A1 (มีลูก 1 ระดับ) ไปใต้ B → A1 ระดับ 2, ลูกระดับ 3 → ได้
    expect(checkPlacement("locations", LOC, "b", "a1")).toBeNull();
    expect(Object.fromEntries(relevel(LOC, "a1", 2))).toEqual({ a1: 2, a1x: 3 });
    // ย้าย A ขึ้นเป็นคลัง (ระดับ 0) → ลูกเลื่อนขึ้นตาม
    expect(Object.fromEntries(relevel(LOC, "a", 0))).toEqual({ a: 0, a1: 1, a1x: 2 });
  });

  it("หมวดหมู่: เริ่มระดับ 1 ซ้อนได้ 3 ระดับ", () => {
    const CAT = [node("c1", null, 1), node("c2", "c1", 2), node("c3", "c2", 3)];
    expect(checkPlacement("categories", CAT, "c2", null)).toBeNull();
    expect(checkPlacement("categories", CAT, "c3", null)).toMatch(/ลึกสุด 3 ระดับ/);
  });

  it("flattenTree เรียงแบบ depth-first", () => {
    expect(flattenTree(LOC).map((n) => n.id)).toEqual(["wh", "a", "a1", "a1x", "wh2", "b"]);
  });
});

const DEFS: AttributeDef[] = [
  { id: "size", name: "ขนาด", dataType: "TEXT", options: [], isRequired: true, isActive: true },
  { id: "len", name: "ความยาว", dataType: "NUMBER", options: [], isRequired: false, isActive: true },
  { id: "color", name: "สี", dataType: "SELECT", options: ["เทา", "น้ำตาล"], isRequired: false, isActive: true },
  { id: "old", name: "เก่า", dataType: "TEXT", options: [], isRequired: true, isActive: false },
];

describe("ค่าคุณสมบัติสินค้า", () => {
  it("ผ่านเมื่อข้อมูลถูกชนิด (ตัวเลขมี comma ได้)", () => {
    expect(validateAttributeValues(DEFS, { size: "145x21", len: "2,900", color: "เทา" })).toEqual({});
    expect(normalizeAttributeValue(DEFS[1], "2,900.5")).toBe("2900.5");
  });

  it("บังคับกรอก / ตัวเลข / ตัวเลือกนอกรายการ / คุณสมบัติที่ไม่รู้จัก", () => {
    const e = validateAttributeValues(DEFS, { len: "ยาว", color: "แดง", ghost: "x" });
    expect(e.size).toMatch(/กรุณากรอก/);
    expect(e.len).toMatch(/ตัวเลข/);
    expect(e.color).toMatch(/เลือกจากรายการ/);
    expect(e.ghost).toBeDefined();
    expect(e.old).toBeUndefined(); // ปิดใช้งานแล้วไม่บังคับ
  });
});

describe("validators เฟส 3", () => {
  it("สินค้าที่สต๊อกได้ต้องมีหน่วย และรหัสเป็นตัวพิมพ์ใหญ่", () => {
    const base = { code: "bw-01", name: "ไม้", isStockable: true };
    const r = productSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["stockUnitId"]);
    expect(productSchema.parse({ ...base, isStockable: false }).code).toBe("BW-01");
    expect(productSchema.safeParse({ ...base, code: "ไม้ 01", isStockable: false }).success).toBe(false);
  });

  it("คุณสมบัติชนิดตัวเลือกต้องมีตัวเลือก และตัดตัวเลือกซ้ำ", () => {
    expect(attributeSchema.safeParse({ name: "สี", dataType: "SELECT", options: [] }).success).toBe(false);
    expect(attributeSchema.parse({ name: "สี", dataType: "SELECT", options: ["เทา", "เทา"] }).options).toEqual(["เทา"]);
    // ชนิดข้อความ: ล้างตัวเลือก/หน่วยกำกับทิ้ง
    expect(attributeSchema.parse({ name: "x", dataType: "TEXT", options: ["a"], unitLabel: "มม." })).toMatchObject({ options: [], unitLabel: null });
  });

  it("tree node: รหัสพิมพ์ใหญ่ ห้ามอักขระพิเศษ", () => {
    expect(treeNodeSchema.parse({ name: "โซน A", code: "a-1" }).code).toBe("A-1");
    expect(treeNodeSchema.safeParse({ name: "x", code: "A 1" }).success).toBe(false);
  });
});
