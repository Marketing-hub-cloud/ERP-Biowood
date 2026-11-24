import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatNumber, formatTime } from "@/lib/format";
import { toCsv, UTF8_BOM } from "@/lib/csv";

describe("format", () => {
  it("วันที่ DD/MM/YYYY เวลา HH:mm ตาม Asia/Bangkok", () => {
    const d = new Date("2024-06-26T17:05:00Z"); // 27/06/2024 00:05 เวลาไทย
    expect(formatDate(d)).toBe("27/06/2024");
    expect(formatTime(d)).toBe("00:05");
    expect(formatDateTime(d)).toBe("27/06/2024 00:05");
    expect(formatDate(null)).toBe("");
  });

  it("ตัวเลขมี comma คั่นหลักพัน", () => {
    expect(formatNumber(192085)).toBe("192,085");
    expect(formatNumber(1234.5, 2)).toBe("1,234.50");
    expect(formatNumber(null)).toBe("");
  });
});

describe("csv", () => {
  it("ขึ้นต้นด้วย BOM และใช้ CRLF", () => {
    const csv = toCsv([{ name: "ทดสอบ" }], [{ header: "ชื่อ", value: (r) => r.name }]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toBe(`${UTF8_BOM}ชื่อ\r\nทดสอบ\r\n`);
  });

  it("escape comma, quote, newline", () => {
    const csv = toCsv([{ v: 'a,"b"\nc' }], [{ header: "v", value: (r) => r.v }]);
    expect(csv).toContain('"a,""b""\nc"');
  });

  it("กันสูตร Excel แต่ไม่แตะตัวเลขติดลบ", () => {
    const csv = toCsv([{ a: "=SUM(A1)", b: "-5", c: -5 }], [
      { header: "a", value: (r) => r.a },
      { header: "b", value: (r) => r.b },
      { header: "c", value: (r) => r.c },
    ]);
    expect(csv).toContain("'=SUM(A1),-5,-5");
  });
});
