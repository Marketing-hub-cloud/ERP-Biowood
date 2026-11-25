import { describe, expect, it } from "vitest";
import { haversineKm, isValidLatLng, roundKm } from "@/lib/distance";
import { canPlanAction, checkPlanAction, projectStepper } from "@/lib/crm";
import { bangkokLocalToDate, dateToBangkokLocal } from "@/lib/date-input";
import { flagsToRow, mergePermissions } from "@/lib/rbac";
import { planActionSchema, projectSchema, workPlanSchema } from "@/lib/validators";

const perms = (f: Record<string, boolean>) => mergePermissions([flagsToRow("crm.plan", f)]);

describe("ระยะทาง (Haversine)", () => {
  it("1 องศาตามเส้นศูนย์สูตร ≈ 111.2 กม.", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.195, 2);
  });
  it("จุดเดียวกัน = 0, สมมาตร", () => {
    const a = { lat: 13.7563, lng: 100.5018 };
    const b = { lat: 13.7650, lng: 100.5383 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
  it("กรุงเทพ (สนามหลวง) → อนุสาวรีย์ชัยฯ ≈ 4.9 กม.", () => {
    const km = haversineKm({ lat: 13.7556, lng: 100.4931 }, { lat: 13.7649, lng: 100.5383 });
    expect(km).toBeGreaterThan(4.8);
    expect(km).toBeLessThan(5.0);
  });
  it("ปัด 3 ตำแหน่ง และตรวจพิกัด", () => {
    expect(roundKm(1.23456)).toBe(1.235);
    expect(isValidLatLng({ lat: 13.7, lng: 100.5 })).toBe(true);
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
  });
});

describe("แผนการทำงาน: สถานะและสิทธิ์", () => {
  const VIEW = perms({ view: true });
  const EDIT = perms({ view: true, edit: true, cancel: true });
  it("วางแผน → เช็คอินเริ่มต้น → เช็คอิน → เช็คอินจุดหมาย → เสร็จสิ้น", () => {
    expect(checkPlanAction("checkin_start", "PLANNED", VIEW, "me", "me")).toEqual({ ok: true, to: "CHECKED_IN" });
    expect(checkPlanAction("checkin_end", "CHECKED_IN", VIEW, "me", "me")).toEqual({ ok: true, to: "DONE" });
  });
  it("เช็คอินจุดหมายก่อนจุดเริ่มต้นไม่ได้; จบแล้วทำอะไรไม่ได้", () => {
    expect(checkPlanAction("checkin_end", "PLANNED", VIEW, "me", "me")).toMatchObject({ ok: false, status: 409, error: "กรุณาเช็คอินจุดเริ่มต้นก่อน" });
    expect(checkPlanAction("checkin_start", "CHECKED_IN", VIEW, "me", "me")).toMatchObject({ ok: false, status: 409 });
    for (const a of ["checkin_start", "complete", "cancel"] as const) {
      expect(checkPlanAction(a, "DONE", EDIT, "me", "me").ok).toBe(false);
      expect(checkPlanAction(a, "CANCELLED", EDIT, "me", "me").ok).toBe(false);
    }
  });
  it("เช็คอินได้เฉพาะเจ้าของแผน แม้มีสิทธิ์แก้ไข", () => {
    expect(checkPlanAction("checkin_start", "PLANNED", EDIT, "boss", "me")).toMatchObject({ ok: false, status: 403 });
    expect(canPlanAction("complete", EDIT, "boss", "me")).toBe(true);
    expect(canPlanAction("cancel", EDIT, "boss", "me")).toBe(true);
    expect(canPlanAction("complete", VIEW, "other", "me")).toBe(false);
    expect(canPlanAction("cancel", VIEW, "me", "me")).toBe(true);
    expect(canPlanAction("checkin_start", perms({}), "me", "me")).toBe(false);
  });
});

describe("วันเวลาไทย", () => {
  it("แปลงไป-กลับไม่ขึ้นกับ timezone เครื่อง", () => {
    const d = bangkokLocalToDate("2026-11-25T09:30")!;
    expect(d.toISOString()).toBe("2026-11-25T02:30:00.000Z");
    expect(dateToBangkokLocal(d)).toBe("2026-11-25T09:30");
    expect(dateToBangkokLocal("2026-11-25T18:00:00.000Z")).toBe("2026-11-26T01:00");
  });
  it("วันที่/เวลาผิด = null", () => {
    expect(bangkokLocalToDate("2026-02-30T09:00")).toBeNull();
    expect(bangkokLocalToDate("2026-11-25T24:00")).toBeNull();
    expect(bangkokLocalToDate("25/11/2026 09:00")).toBeNull();
  });
});

describe("validators CRM", () => {
  const plan = { subject: "เยี่ยมลูกค้า", plannedStart: "2026-11-25T09:00", plannedEnd: "2026-11-25T10:00", employeeId: "u1" };
  it("แผน: สิ้นสุดต้องไม่ก่อนเริ่ม", () => {
    expect(workPlanSchema.safeParse(plan).success).toBe(true);
    expect(workPlanSchema.safeParse({ ...plan, plannedEnd: "2026-11-25T08:59" }).success).toBe(false);
  });
  it("เช็คอินต้องมีพิกัด", () => {
    expect(planActionSchema.safeParse({ action: "checkin_start" }).success).toBe(false);
    expect(planActionSchema.safeParse({ action: "checkin_start", lat: 13.7, lng: 100.5 }).success).toBe(true);
    expect(planActionSchema.safeParse({ action: "checkin_start", lat: 200, lng: 100.5 }).success).toBe(false);
    expect(planActionSchema.safeParse({ action: "complete" }).success).toBe(true);
  });
  const proj = { name: "บ้านคุณเอ", customerId: "c1" };
  it("โครงการ: % โอกาสสำเร็จ 10–100 ทีละ 10, มูลค่ามี comma ได้", () => {
    expect(projectSchema.parse({ ...proj, probability: "70", value: "192,085.50" })).toMatchObject({ probability: 70, value: 192085.5 });
    expect(projectSchema.safeParse({ ...proj, probability: "75" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...proj, probability: 0 }).success).toBe(false);
    expect(projectSchema.parse({ ...proj, probability: "" }).probability).toBeNull();
  });
  it("โครงการ: ต้องมีลูกค้า, วันสิ้นสุดรับประกันไม่ก่อนวันเริ่ม", () => {
    expect(projectSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(projectSchema.safeParse({ ...proj, warrantyStart: "2026-01-02", warrantyEnd: "2026-01-01" }).success).toBe(false);
  });
  it("stepper โครงการ 9 สถานะ", () => {
    const s = projectStepper("WON");
    expect(s).toHaveLength(9);
    expect(s.map((x) => x.state).slice(0, 5)).toEqual(["done", "done", "done", "current", "todo"]);
  });
});
