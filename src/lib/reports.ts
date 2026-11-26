// โครงสร้างรายงาน (ใช้ได้ทั้ง client และ server) — นิยามรายงานจริงอยู่ที่ src/server/reports
export type ReportModule = "crm" | "inventory" | "purchase";

export const REPORT_MODULES: Record<ReportModule, { menuKey: string; section: string; href: string }> = {
  crm: { menuKey: "crm.report", section: "การขาย (CRM)", href: "/crm/reports" },
  inventory: { menuKey: "inventory.report", section: "คลังสินค้า", href: "/inventory/reports" },
  purchase: { menuKey: "purchase.report", section: "จัดซื้อ", href: "/purchase/reports" },
};

export type ReportOption = { value: string; label: string };

/**
 * ตัวกรองของรายงาน (ส่งเป็น query f_<id>)
 * - dateRange: f_from / f_to (YYYY-MM-DD) ค่าเริ่มต้น = ต้นเดือนถึงวันนี้ (defaultEmpty = ไม่กรอง)
 * - date: f_<id> (YYYY-MM-DD) ค่าเริ่มต้น = วันนี้
 * - select: ตัวเลือก (ค้นหาได้)
 */
export type ReportFilter =
  | { id: "date"; type: "dateRange"; label: string; defaultEmpty?: boolean }
  | { id: string; type: "date"; label: string }
  /** required = ไม่มีตัวเลือก "ทั้งหมด" (ใช้ defaultValue หรือตัวเลือกแรก) */
  | { id: string; type: "select"; label: string; options: ReportOption[]; allLabel?: string; required?: boolean; defaultValue?: string };

export type ReportColumn = {
  key: string;
  header: string;
  /** number = แสดงมี comma ชิดขวา (CSV ส่งตัวเลขดิบให้ Excel คำนวณได้) */
  type?: "text" | "number";
  decimals?: number;
};

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export type ReportResult = {
  columns: ReportColumn[];
  rows: ReportRow[];
  /** แถวรวมท้ายตาราง (ถ้ามี) */
  totals?: ReportRow;
};

export type ReportMeta = { key: string; title: string; description: string; filters: ReportFilter[] };

/** แสดงตัวอย่างในหน้าจอได้ไม่เกินนี้ (Export CSV ได้ครบทุกแถว) */
export const REPORT_PREVIEW_LIMIT = 500;
