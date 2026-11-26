import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

/** คอลัมน์ในแม่แบบ CSV (หัวตารางภาษาไทยตรงตามนี้) */
export type ImportColumn = { header: string; required?: boolean; example: string; help: string };

export type RowError = { row: number; column?: string; message: string };

export type PlannedRow<T> = { row: number; data: T; action: "create" | "skip"; note?: string };

export type ImportPlan<T> = {
  rows: PlannedRow<T>[];
  errors: RowError[];
  /** ข้อมูลประกอบที่จะสร้างเพิ่ม (เช่น ตัวเลือกใหม่, หน่วยใหม่) */
  notes: string[];
};

export type ImportContext = {
  actor: CurrentUser;
  /** ชื่อไฟล์ต้นทาง (เก็บใน audit/หมายเหตุ) */
  source: string;
  /** วันที่เอกสาร (ยอดยกมา) YYYY-MM-DD */
  date: string;
};

export type ImportResult = { created: number; skipped: number; notes: string[] };

export interface Importer<T> {
  kind: string;
  title: string;
  description: string;
  /** แม่แบบ = หัวตาราง + แถวตัวอย่างจาก example */
  columns: ImportColumn[];
  /** รับคอลัมน์ที่ไม่อยู่ใน columns ได้ (เช่น คุณสมบัติสินค้า) — คืนข้อความ error ถ้าไม่รับ */
  extraColumn?: (header: string) => Promise<string | null>;
  /** ตรวจทุกแถว (ไม่เขียน DB) */
  plan(records: Record<string, string>[], ctx: ImportContext): Promise<ImportPlan<T>>;
  /** เขียน DB (เรียกเมื่อ plan ไม่มี error เท่านั้น) */
  commit(plan: ImportPlan<T>, ctx: ImportContext): Promise<ImportResult>;
}

/** แถวใน CSV (บรรทัดที่ 1 = หัวตาราง) */
export const csvRow = (index: number) => index + 2;

/** ตรวจหัวตาราง: คอลัมน์บังคับต้องมี, คอลัมน์ที่ไม่รู้จักต้องผ่าน extraColumn */
export async function checkHeaders(imp: Importer<unknown>, headers: string[]): Promise<RowError[]> {
  const errors: RowError[] = [];
  const known = new Set(imp.columns.map((c) => c.header));
  for (const c of imp.columns) if (c.required && !headers.includes(c.header)) errors.push({ row: 1, column: c.header, message: `ไม่มีคอลัมน์บังคับ "${c.header}"` });
  const seen = new Set<string>();
  for (const h of headers) {
    if (!h) continue;
    if (seen.has(h)) errors.push({ row: 1, column: h, message: `คอลัมน์ "${h}" ซ้ำ` });
    seen.add(h);
    if (known.has(h)) continue;
    const err = imp.extraColumn ? await imp.extraColumn(h) : `ไม่รู้จักคอลัมน์ "${h}" (ดูหัวตารางในแม่แบบ)`;
    if (err) errors.push({ row: 1, column: h, message: err });
  }
  return errors;
}

type LookupKind = Prisma.LookupOptionCreateInput["kind"];

/** ตัวเลือก (lookup) ตามชื่อ — ไม่พบจะสร้างใหม่ตอน commit (จดไว้ใน notes ตอน plan) */
export class LookupResolver {
  private cache = new Map<string, Map<string, string>>();
  readonly pending = new Map<LookupKind, Set<string>>();

  async load(kind: LookupKind) {
    if (!this.cache.has(kind)) {
      // เฉพาะที่เปิดใช้งาน — ตัวเลือกที่ปิดไว้จะถูกเปิดใช้อีกครั้งตอน commit (upsert)
      const xs = await prisma.lookupOption.findMany({ where: { kind, isActive: true } });
      this.cache.set(kind, new Map(xs.map((x) => [x.label.toLowerCase(), x.id])));
    }
    return this.cache.get(kind)!;
  }

  /** plan: จดชื่อที่ยังไม่มี */
  async note(kind: LookupKind, label: string) {
    if (!label) return;
    if (!(await this.load(kind)).has(label.toLowerCase())) {
      const set = this.pending.get(kind) ?? new Set<string>();
      set.add(label);
      this.pending.set(kind, set);
    }
  }

  /** commit: id ของตัวเลือก (สร้างถ้ายังไม่มี) */
  async id(tx: TxClient | typeof prisma, kind: LookupKind, label: string): Promise<string | null> {
    if (!label) return null;
    const map = await this.load(kind);
    const hit = map.get(label.toLowerCase());
    if (hit) return hit;
    const o = await tx.lookupOption.upsert({ where: { kind_label: { kind, label } }, update: { isActive: true }, create: { kind, label, sortOrder: 999 } });
    map.set(label.toLowerCase(), o.id);
    return o.id;
  }

  describe(names: Record<string, string>): string[] {
    return [...this.pending.entries()].map(([k, set]) => `จะสร้างตัวเลือก "${names[k] ?? k}" ใหม่ ${set.size} รายการ: ${[...set].slice(0, 10).join(", ")}${set.size > 10 ? " ..." : ""}`);
  }
}

/** กลุ่ม (tag) ตามชื่อ — สร้างใหม่ถ้ายังไม่มี */
export async function tagIds(names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) ids.push((await prisma.tag.upsert({ where: { name }, update: {}, create: { name } })).id);
  return ids;
}

/** ข้อความ error ของ zod/ApiError แบบอ่านง่าย */
export function errorText(e: unknown): string {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    return (e as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.join(".") || "-"}: ${i.message}`).join("; ");
  }
  return e instanceof Error ? e.message : String(e);
}

/** ชื่อฟิลด์ใน schema → หัวคอลัมน์ใน CSV (ให้ผู้ใช้หาแถว/คอลัมน์ที่ต้องแก้ได้) — ลองทั้ง path เต็ม แล้วตัดท้ายทีละส่วน */
export function headerFor(path: PropertyKey[], map: Record<string, string>): string {
  const parts = path.map(String);
  for (let n = parts.length; n > 0; n--) {
    const key = parts.slice(0, n).join(".");
    if (map[key]) return map[key];
    const generic = parts.slice(0, n).map((p) => (/^\d+$/.test(p) ? "*" : p)).join(".");
    if (map[generic]) return map[generic];
  }
  return parts.join(".");
}
