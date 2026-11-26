// ตารางงานพนักงานส่ง: สถานะ, สิทธิ์ของ action, ลิงก์แผนที่ (ใช้ได้ทั้ง client และ server)
import { can, type PermissionMap } from "./rbac";

export type DeliveryStatus = "SCHEDULED" | "DELIVERED" | "CANCELLED";
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  SCHEDULED: "นัดส่ง",
  DELIVERED: "ส่งแล้ว",
  CANCELLED: "ยกเลิก",
};

export const DELIVERY_MENU = "inventory.delivery";

export type DeliveryAction = "deliver" | "cancel";
export const DELIVERY_ACTION_LABELS: Record<DeliveryAction, string> = { deliver: "ส่งแล้ว", cancel: "ยกเลิก" };

/**
 * - ส่งแล้ว: พนักงานจัดส่งของงานนั้น หรือผู้มีสิทธิ์แก้ไข
 * - ยกเลิก: ผู้มีสิทธิ์ยกเลิก
 * - แก้ไขรายละเอียด: ผู้มีสิทธิ์แก้ไข (เฉพาะงานที่ยังไม่ส่ง/ไม่ยกเลิก)
 */
export function canDeliveryAction(a: DeliveryAction, perms: PermissionMap, userId: string, driverId: string): boolean {
  if (!can(perms, DELIVERY_MENU, "view")) return false;
  if (a === "deliver") return userId === driverId || can(perms, DELIVERY_MENU, "edit");
  return can(perms, DELIVERY_MENU, "cancel");
}

export type DeliveryActionCheck = { ok: true; to: DeliveryStatus } | { ok: false; status: 403 | 409; error: string };

export function checkDeliveryAction(a: DeliveryAction, status: DeliveryStatus, perms: PermissionMap, userId: string, driverId: string): DeliveryActionCheck {
  if (status !== "SCHEDULED") return { ok: false, status: 409, error: `งานจัดส่งสถานะ "${DELIVERY_STATUS_LABELS[status]}" ${DELIVERY_ACTION_LABELS[a]}ไม่ได้` };
  if (!canDeliveryAction(a, perms, userId, driverId)) return { ok: false, status: 403, error: `ไม่มีสิทธิ์${a === "deliver" ? "บันทึกส่งแล้ว" : "ยกเลิก"}งานจัดส่งนี้` };
  return { ok: true, to: a === "deliver" ? "DELIVERED" : "CANCELLED" };
}

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** "lat,lng" -> พิกัด (ตรวจช่วงค่า) */
export function parseCoord(s: string): { lat: number; lng: number } | null {
  const m = COORD.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** ช่อง "ลิงก์/พิกัด Google Map" รับได้ทั้งลิงก์ http(s) และพิกัด "lat,lng" */
export function isValidMapInput(s: string): boolean {
  if (parseCoord(s)) return true;
  try {
    const u = new URL(s.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** ลิงก์ที่เปิดได้จากค่าที่กรอก (พิกัด -> ลิงก์ Google Maps) */
export function mapHref(s: string | null | undefined): string | null {
  if (!s) return null;
  const c = parseCoord(s);
  if (c) return `https://www.google.com/maps?q=${c.lat},${c.lng}`;
  return isValidMapInput(s) ? s.trim() : null;
}
