import { describe, expect, it } from "vitest";
import { diff, sanitize } from "@/lib/audit";

describe("audit diff", () => {
  it("เก็บเฉพาะฟิลด์ที่เปลี่ยน", () => {
    expect(diff({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: null })).toEqual({ b: ["x", "y"] });
  });

  it("ไม่เก็บรหัสผ่านและฟิลด์ updatedAt", () => {
    const d = diff({ passwordHash: "old", updatedAt: new Date(1) }, { passwordHash: "new", updatedAt: new Date(2) });
    expect(d).toEqual({});
    expect(sanitize({ passwordHash: "x", email: "a@b.c" })).toEqual({ email: "a@b.c" });
  });

  it("เทียบ array/object ตามค่า", () => {
    expect(diff({ groups: ["A", "B"] }, { groups: ["A", "B"] })).toEqual({});
    expect(diff({ groups: ["A"] }, { groups: ["A", "B"] })).toEqual({ groups: [["A"], ["A", "B"]] });
  });

  it("undefined กับ null ถือว่าเท่ากัน", () => {
    expect(diff({ a: null }, {})).toEqual({});
  });

  it("แปลง Date เป็น ISO string", () => {
    expect(sanitize({ d: new Date("2024-01-01T00:00:00Z") })).toEqual({ d: "2024-01-01T00:00:00.000Z" });
  });
});
