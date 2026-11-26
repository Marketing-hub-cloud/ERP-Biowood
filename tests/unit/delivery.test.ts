import { describe, expect, it } from "vitest";
import { canDeliveryAction, checkDeliveryAction, isValidMapInput, mapHref, parseCoord } from "@/lib/delivery";
import { flagsToRow, mergePermissions } from "@/lib/rbac";
import { viewDays, weekStart } from "@/components/calendar/schedule-calendar";
import { eventsByDay } from "@/components/calendar/month-calendar";

const perms = (flags: Record<string, boolean>) => mergePermissions([flagsToRow("inventory.delivery", flags)]);

describe("สิทธิ์งานจัดส่ง", () => {
  it("ส่งแล้ว: พนักงานส่งของงานนั้น หรือผู้มีสิทธิ์แก้ไข", () => {
    expect(canDeliveryAction("deliver", perms({ view: true }), "u1", "u1")).toBe(true);
    expect(canDeliveryAction("deliver", perms({ view: true }), "u2", "u1")).toBe(false);
    expect(canDeliveryAction("deliver", perms({ view: true, edit: true }), "u2", "u1")).toBe(true);
  });
  it("ยกเลิก: ต้องมีสิทธิ์ยกเลิก (พนักงานส่งยกเลิกเองไม่ได้)", () => {
    expect(canDeliveryAction("cancel", perms({ view: true }), "u1", "u1")).toBe(false);
    expect(canDeliveryAction("cancel", perms({ view: true, cancel: true }), "u2", "u1")).toBe(true);
  });
  it("ไม่มีสิทธิ์ดู = ทำอะไรไม่ได้ (แม้เป็นพนักงานส่ง)", () => {
    expect(canDeliveryAction("deliver", perms({}), "u1", "u1")).toBe(false);
  });
  it("งานที่ไม่ใช่นัดส่ง → 409", () => {
    expect(checkDeliveryAction("deliver", "DELIVERED", perms({ view: true }), "u1", "u1")).toMatchObject({ ok: false, status: 409 });
    expect(checkDeliveryAction("deliver", "SCHEDULED", perms({ view: true }), "u1", "u1")).toEqual({ ok: true, to: "DELIVERED" });
    expect(checkDeliveryAction("cancel", "SCHEDULED", perms({ view: true }), "u1", "u1")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("ลิงก์/พิกัด Google Map", () => {
  it("พิกัด lat,lng → ลิงก์ Google Maps", () => {
    expect(parseCoord(" 13.7563 , 100.5018 ")).toEqual({ lat: 13.7563, lng: 100.5018 });
    expect(parseCoord("95,100")).toBeNull();
    expect(mapHref("13.7563,100.5018")).toBe("https://www.google.com/maps?q=13.7563,100.5018");
  });
  it("รับเฉพาะลิงก์ http(s)", () => {
    expect(isValidMapInput("https://maps.app.goo.gl/xyz")).toBe(true);
    expect(isValidMapInput("javascript:alert(1)")).toBe(false);
    expect(mapHref("javascript:alert(1)")).toBeNull();
    expect(mapHref("")).toBeNull();
  });
});

describe("ปฏิทิน เดือน/สัปดาห์/วัน", () => {
  it("สัปดาห์เริ่มวันจันทร์", () => {
    expect(weekStart("2026-11-26")).toBe("2026-11-23"); // พฤหัส → จันทร์
    expect(weekStart("2026-11-29")).toBe("2026-11-23"); // อาทิตย์ → จันทร์ก่อนหน้า
    expect(viewDays("week", "2026-11-26")).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  });
  it("มุมมองวัน = วันเดียว, เดือน = 42 วัน", () => {
    expect(viewDays("day", "2026-11-26")).toEqual(["2026-11-26"]);
    const m = viewDays("month", "2026-11-26");
    expect(m).toHaveLength(42);
    expect(m[0]).toBe("2026-10-26");
  });
  it("งานหลายวันอยู่ทุกวันที่ครอบคลุม (เวลาไทย) และเรียงตามเวลาเริ่ม", () => {
    const ev = (id: string, start: string, end: string) => ({ id, title: id, start, end, href: "#" });
    const map = eventsByDay(
      [ev("b", "2026-11-24T03:00:00Z", "2026-11-25T10:00:00Z"), ev("a", "2026-11-24T01:00:00Z", "2026-11-24T02:00:00Z"), ev("late", "2026-11-24T18:00:00Z", "2026-11-24T19:00:00Z")],
      viewDays("week", "2026-11-24"),
    );
    expect(map.get("2026-11-24")?.map((e) => e.id)).toEqual(["a", "b"]);
    // 18:00Z = 01:00 ของวันที่ 25 เวลาไทย
    expect(map.get("2026-11-25")?.map((e) => e.id)).toEqual(["b", "late"]);
  });
});
