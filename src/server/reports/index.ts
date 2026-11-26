import "server-only";
import { toCsv } from "@/lib/csv";
import type { ReportMeta, ReportModule, ReportResult } from "@/lib/reports";
import { CRM_REPORTS } from "./crm";
import { INVENTORY_REPORTS } from "./inventory";
import { PURCHASE_REPORTS } from "./purchase";
import type { ReportDef } from "./common";

export const REPORTS: Record<ReportModule, ReportDef[]> = {
  crm: CRM_REPORTS,
  inventory: INVENTORY_REPORTS,
  purchase: PURCHASE_REPORTS,
};

export const isReportModule = (m: string): m is ReportModule => m in REPORTS;

export function findReport(module: ReportModule, key: string): ReportDef | undefined {
  return REPORTS[module].find((r) => r.key === key);
}

export async function reportMeta(r: ReportDef): Promise<ReportMeta> {
  return { key: r.key, title: r.title, description: r.description, filters: await r.filters() };
}

/** CSV (UTF-8 BOM) — ตัวเลขส่งเป็นค่าดิบให้ Excel คำนวณได้, แถวรวมต่อท้าย */
export function reportCsv(res: ReportResult): string {
  const rows = res.totals ? [...res.rows, res.totals] : res.rows;
  return toCsv(
    rows,
    res.columns.map((c) => ({ header: c.header, value: (r) => r[c.key] })),
  );
}
