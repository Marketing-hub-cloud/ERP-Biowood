import { describe, expect, it } from "vitest";
import { dateKey, formatDocNumber } from "@/lib/doc-number";

describe("เลขที่เอกสาร", () => {
  it("รูปแบบ PREFIX + YYMMDD + 4 หลัก", () => {
    expect(formatDocNumber("PR", "240627", 1)).toBe("PR2406270001");
    expect(formatDocNumber("PO", "241231", 123)).toBe("PO2412310123");
  });

  it("dateKey ใช้เวลา Asia/Bangkok", () => {
    // 2024-06-26 17:30 UTC = 2024-06-27 00:30 เวลาไทย → ต้องเป็นวันใหม่แล้ว
    expect(dateKey(new Date("2024-06-26T17:30:00Z"))).toBe("240627");
    // 2024-06-26 16:59 UTC = 23:59 เวลาไทย → ยังเป็นวันเดิม
    expect(dateKey(new Date("2024-06-26T16:59:00Z"))).toBe("240626");
  });

  it("เกิน 9999 ใบต่อวันต้อง error", () => {
    expect(() => formatDocNumber("PR", "240627", 10000)).toThrow();
  });
});
