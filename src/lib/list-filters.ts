// ตัวกรองช่วงวันที่ของหน้ารายการ (f_from / f_to เป็น YYYY-MM-DD)
import { dateOnly } from "./stock-rules";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function dateRangeFilter(filters: Record<string, string>): { gte?: Date; lte?: Date } | undefined {
  const r: { gte?: Date; lte?: Date } = {};
  if (ISO.test(filters.from ?? "")) r.gte = dateOnly(filters.from);
  if (ISO.test(filters.to ?? "")) r.lte = dateOnly(filters.to);
  return r.gte || r.lte ? r : undefined;
}
