import "server-only";
import { toCsv } from "@/lib/csv";
import { csvToRecords } from "@/lib/csv-parse";
import { checkHeaders, type ImportContext, type ImportPlan, type ImportResult, type Importer, type RowError } from "./common";
import { contactPersonsImporter, contactsImporter } from "./contacts";
import { productsImporter } from "./products";
import { projectsImporter } from "./projects";
import { openingStockImporter } from "./opening-stock";

/** ลำดับที่ควรนำเข้า (ข้อมูลหลังอ้างอิงข้อมูลก่อนหน้า) */
export const IMPORTERS: Importer<unknown>[] = [contactsImporter, contactPersonsImporter, productsImporter, projectsImporter, openingStockImporter] as Importer<unknown>[];

export const findImporter = (kind: string) => IMPORTERS.find((i) => i.kind === kind);

/** แม่แบบ CSV: หัวตาราง + แถวตัวอย่าง (UTF-8 BOM เปิดใน Excel ได้) */
export function templateCsv(imp: Importer<unknown>): string {
  return toCsv([imp.columns], imp.columns.map((c, i) => ({ header: c.header, value: (cols: typeof imp.columns) => cols[i].example })));
}

export type ImportRun = {
  plan: ImportPlan<unknown>;
  /** null = dry run หรือมี error (ไม่ได้เขียน DB) */
  result: ImportResult | null;
  summary: { total: number; create: number; skip: number; errors: number };
};

/**
 * ตรวจไฟล์ (เสมอ) แล้วเขียน DB เมื่อ commit = true และไม่มี error เลย
 * (มี error แม้แถวเดียว = ไม่นำเข้าอะไร ให้แก้ไฟล์แล้วรันใหม่ — แถวที่มีอยู่แล้วจะถูกข้าม จึงรันซ้ำได้)
 */
export async function runImport(imp: Importer<unknown>, csvText: string, ctx: ImportContext, commit: boolean): Promise<ImportRun> {
  const { headers, records } = csvToRecords(csvText);
  const headerErrors = await checkHeaders(imp, headers);
  const plan: ImportPlan<unknown> = headerErrors.length ? { rows: [], errors: headerErrors, notes: [] } : await imp.plan(records, ctx);
  if (!headerErrors.length && !records.length) plan.errors.push({ row: 1, message: "ไม่มีข้อมูลในไฟล์" });
  const summary = {
    total: records.length,
    create: plan.rows.filter((r) => r.action === "create").length,
    skip: plan.rows.filter((r) => r.action === "skip").length,
    errors: plan.errors.length,
  };
  const result = commit && !plan.errors.length ? await imp.commit(plan, ctx) : null;
  return { plan, result, summary };
}

/** รายงาน error เป็น CSV (เปิดใน Excel แล้วแก้ตามแถว) */
export function errorsCsv(errors: RowError[]): string {
  return toCsv(errors, [
    { header: "แถว", value: (e) => e.row },
    { header: "คอลัมน์", value: (e) => e.column ?? "" },
    { header: "ข้อผิดพลาด", value: (e) => e.message },
  ]);
}
