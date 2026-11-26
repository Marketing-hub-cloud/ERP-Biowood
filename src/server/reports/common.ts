import "server-only";
import { prisma } from "@/lib/db";
import { bangkokLocalToDate } from "@/lib/date-input";
import { formatDate, fullName } from "@/lib/format";
import { dateOnly } from "@/lib/stock-rules";
import { pathLabel, type TreeNode } from "@/lib/tree";
import type { ReportFilter, ReportOption, ReportResult } from "@/lib/reports";
import type { CurrentUser } from "@/lib/session";

export type Filters = Record<string, string>;

export type ReportDef = {
  key: string;
  title: string;
  description: string;
  /** ตัวกรอง (โหลดตัวเลือกจาก DB ตอนเปิดหน้า) */
  filters: () => Promise<ReportFilter[]>;
  run: (f: Filters, user: CurrentUser) => Promise<ReportResult>;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isoParam = (v: string | undefined) => (v && ISO.test(v) ? v : null);

/** ช่วงวันที่ f_from/f_to สำหรับคอลัมน์วันเวลา (เวลาไทย, ถึงสิ้นวัน) */
export function timeRange(f: Filters): { gte?: Date; lt?: Date } | undefined {
  const from = isoParam(f.from);
  const to = isoParam(f.to);
  const r: { gte?: Date; lt?: Date } = {};
  if (from) r.gte = bangkokLocalToDate(`${from}T00:00`)!;
  if (to) r.lt = new Date(bangkokLocalToDate(`${to}T00:00`)!.getTime() + 24 * 3600_000);
  return r.gte || r.lt ? r : undefined;
}

/** ช่วงวันที่ f_from/f_to สำหรับคอลัมน์ @db.Date */
export function dayRange(f: Filters): { gte?: Date; lte?: Date } | undefined {
  const from = isoParam(f.from);
  const to = isoParam(f.to);
  const r: { gte?: Date; lte?: Date } = {};
  if (from) r.gte = dateOnly(from);
  if (to) r.lte = dateOnly(to);
  return r.gte || r.lte ? r : undefined;
}

export const qty = (n: number | string | null | undefined) => (n === null || n === undefined ? null : Math.round(Number(n) * 1000) / 1000);
export const money = (n: number | string | null | undefined) => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);
export const d = (v: Date | null | undefined) => (v ? formatDate(v) : null);

/** optional = ค่าเริ่มต้นไม่กรองวันที่ (เช่น รายงานยอดค้าง) — ไม่ optional = เริ่มที่ต้นเดือนถึงวันนี้ */
export const dateRangeFilter = (label: string, optional = false): ReportFilter => ({ id: "date", type: "dateRange", label, defaultEmpty: optional });

export const selectFilter = (id: string, label: string, options: ReportOption[], allLabel = "ทั้งหมด"): ReportFilter => ({ id, type: "select", label, options, allLabel });

export const enumOptions = (labels: Record<string, string>): ReportOption[] => Object.entries(labels).map(([value, label]) => ({ value, label }));

export async function userOptions(): Promise<ReportOption[]> {
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, status: true }, orderBy: [{ status: "asc" }, { firstName: "asc" }] });
  return users.map((u) => ({ value: u.id, label: `${fullName(u)}${u.status === "ACTIVE" ? "" : " (หยุดใช้งาน)"}` }));
}

export async function warehouseOptions(): Promise<ReportOption[]> {
  const ws = await prisma.stockLocation.findMany({ where: { level: 0 }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return ws.map((w) => ({ value: w.id, label: w.name }));
}

export async function productOptions(): Promise<ReportOption[]> {
  const ps = await prisma.product.findMany({ where: { deletedAt: null, isStockable: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  return ps.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }));
}

export async function vendorOptions(): Promise<ReportOption[]> {
  const vs = await prisma.contact.findMany({ where: { isVendor: true, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } });
  return vs.map((v) => ({ value: v.id, label: `${v.code} ${v.name}` }));
}

/** ชื่อสถานที่ใต้คลัง (ไม่ซ้ำชื่อคลัง) — "-" ถ้าเก็บที่ระดับคลัง */
export async function locationLabeler() {
  const nodes = (await prisma.stockLocation.findMany()) as TreeNode[];
  return (warehouseId: string | null, locationId: string | null) =>
    locationId && locationId !== warehouseId ? pathLabel(nodes, locationId).split(" > ").slice(1).join(" > ") : "-";
}
