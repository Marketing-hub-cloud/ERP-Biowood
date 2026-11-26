import { ApiError, apiHandler, parseListParams } from "@/lib/api";
import { can } from "@/lib/rbac";
import { csvResponse } from "@/lib/csv";
import { REPORT_MODULES, REPORT_PREVIEW_LIMIT } from "@/lib/reports";
import { todayBangkok } from "@/lib/stock-rules";
import { findReport, isReportModule, reportCsv } from "@/server/reports";

type P = { module: string; key: string };

/**
 * รันรายงาน: ตัวกรองส่งเป็น f_<id> (ช่วงวันที่ f_from/f_to)
 * ?format=csv = ไฟล์ CSV ครบทุกแถว, ไม่ระบุ = JSON แสดงตัวอย่างไม่เกิน REPORT_PREVIEW_LIMIT แถว
 * สิทธิ์: ดูเมนู "รายงาน" ของโมดูลนั้น
 */
export const GET = apiHandler<P>({}, async ({ req, user, params }) => {
  if (!isReportModule(params.module)) throw new ApiError(404, "ไม่พบรายงาน");
  if (!can(user.permissions, REPORT_MODULES[params.module].menuKey, "view")) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const report = findReport(params.module, params.key);
  if (!report) throw new ApiError(404, "ไม่พบรายงาน");
  const p = parseListParams(req, []);
  const res = await report.run(p.filters, user);
  if (p.format === "csv") return csvResponse(reportCsv(res), `${params.module}-${report.key}-${todayBangkok()}.csv`);
  return { columns: res.columns, rows: res.rows.slice(0, REPORT_PREVIEW_LIMIT), totals: res.totals ?? null, total: res.rows.length };
});
