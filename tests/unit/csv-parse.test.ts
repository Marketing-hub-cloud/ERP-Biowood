import { describe, expect, it } from "vitest";
import { csvToRecords, parseBool, parseCsv, parseDate, parseNumber, splitList } from "@/lib/csv-parse";
import { splitSerials } from "@/server/import/opening-stock";
import { toCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("BOM, ช่องมี quote/comma/ขึ้นบรรทัด, CRLF, ตัดแถวว่าง", () => {
    const text = '﻿รหัส,ชื่อ,ที่อยู่\r\nC1,"บริษัท ""เอ"" จำกัด","99/1, ถนนสุขุมวิท\nกรุงเทพ"\r\n,,\r\nC2,บี,\r\n';
    expect(parseCsv(text)).toEqual([
      ["รหัส", "ชื่อ", "ที่อยู่"],
      ["C1", 'บริษัท "เอ" จำกัด', "99/1, ถนนสุขุมวิท\nกรุงเทพ"],
      ["C2", "บี", ""],
    ]);
  });
  it("ตรวจตัวคั่น ; และ tab จากหัวตาราง", () => {
    expect(parseCsv("a;b\n1;2,5")).toEqual([["a", "b"], ["1", "2,5"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("อ่านไฟล์ที่ระบบเขียนเอง (toCsv) กลับได้ตรง", () => {
    const rows = [{ a: "=SUM(1)", b: 'x"y', c: "1,234" }];
    const csv = toCsv(rows, [
      { header: "A", value: (r) => r.a },
      { header: "B", value: (r) => r.b },
      { header: "C", value: (r) => r.c },
    ]);
    expect(csvToRecords(csv).records[0]).toEqual({ A: "'=SUM(1)", B: 'x"y', C: "1,234" });
  });
  it("csvToRecords ตัดช่องว่าง และเติมช่องที่ขาด", () => {
    expect(csvToRecords(" รหัส , ชื่อ \n C1 \n")).toEqual({ headers: ["รหัส", "ชื่อ"], records: [{ รหัส: "C1", ชื่อ: "" }] });
  });
});

describe("แปลงค่า", () => {
  it("วันที่: DD/MM/YYYY, YYYY-MM-DD, พ.ศ., วันที่ไม่มีจริง", () => {
    expect(parseDate("31/12/2026")).toBe("2026-12-31");
    expect(parseDate("1/2/2026")).toBe("2026-02-01");
    expect(parseDate("2026-02-01")).toBe("2026-02-01");
    expect(parseDate("31/12/2569")).toBe("2026-12-31");
    expect(parseDate("31/02/2026")).toBeUndefined();
    expect(parseDate("12/31/2026")).toBeUndefined();
    expect(parseDate("")).toBeNull();
  });
  it("ใช่/ไม่, ตัวเลขมี comma, รายการหลายค่า", () => {
    expect(parseBool("ใช่", false)).toBe(true);
    expect(parseBool("N", true)).toBe(false);
    expect(parseBool("", true)).toBe(true);
    expect(parseBool("บางที", true)).toBeUndefined();
    expect(parseNumber("192,085.50")).toBe(192085.5);
    expect(parseNumber("12a")).toBeUndefined();
    expect(splitList("VIP, กรุงเทพ;  ,ภาคเหนือ")).toEqual(["VIP", "กรุงเทพ", "ภาคเหนือ"]);
  });
  it("แบ่งจำนวนเป็น SN (เศษอยู่ SN สุดท้าย, ทศนิยมไม่เพี้ยน)", () => {
    expect(splitSerials(120, 10)).toHaveLength(12);
    expect(splitSerials(25, 10)).toEqual([10, 10, 5]);
    expect(splitSerials(0.3, 0.1)).toEqual([0.1, 0.1, 0.1]);
    expect(splitSerials(7, null)).toEqual([7]);
    expect(splitSerials(7, 50)).toEqual([7]);
  });
});
