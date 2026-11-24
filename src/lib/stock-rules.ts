// กติกาของคลัง (ใช้ได้ทั้ง client/server ไม่แตะฐานข้อมูล)

export const QTY_DECIMALS = 3;
/** SN ต่อใบนำเข้า (barcode ใช้ลำดับ 3 หลัก) */
export const MAX_SERIALS_PER_RECEIPT = 999;
/** สร้าง SN ได้ครั้งละไม่เกิน */
export const MAX_SERIALS_PER_BATCH = 500;

export const RECEIPT_TYPE_LABELS = { PURCHASE: "สั่งซื้อ", OTHER: "อื่นๆ" } as const;
export const ISSUE_TYPE_LABELS = { SALE: "ขาย", RETURN: "ส่งคืน", SAMPLE: "เบิกตัวอย่าง", OTHER: "อื่นๆ" } as const;
/** ประเภทที่ยังเปิดใช้ไม่ได้ (ต้องมีเอกสารจัดซื้อจากเฟส 5) */
export const DISABLED_RECEIPT_TYPES = ["PURCHASE"] as const;
export const DISABLED_ISSUE_TYPES = ["RETURN"] as const;

export type StockDocStatus = "DRAFT" | "POSTED" | "CANCELLED";
export const RECEIPT_STATUS_LABELS: Record<StockDocStatus, string> = { DRAFT: "ร่าง", POSTED: "นำเข้าแล้ว", CANCELLED: "ยกเลิก" };
export const ISSUE_STATUS_LABELS: Record<StockDocStatus, string> = { DRAFT: "ร่าง", POSTED: "นำออกแล้ว", CANCELLED: "ยกเลิก" };
export const MOVEMENT_TYPE_LABELS = {
  RECEIPT: "นำเข้า",
  ISSUE: "นำออก",
  RECEIPT_REVERSAL: "ยกเลิกนำเข้า",
  ISSUE_REVERSAL: "ยกเลิกนำออก",
} as const;

/** barcode ของ SN: เลขที่ใบนำเข้า + "-" + ลำดับ 3 หลัก เช่น GR2611240001-001 */
export function serialBarcode(docNo: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_SERIALS_PER_RECEIPT) throw new Error(`ลำดับ SN ต้องอยู่ระหว่าง 1–${MAX_SERIALS_PER_RECEIPT}`);
  return `${docNo}-${String(seq).padStart(3, "0")}`;
}

/** วางแผนสร้าง SN ต่อจากลำดับล่าสุดของใบ — คืน error เป็นข้อความถ้าเกินขีดจำกัด */
export function planSerials(docNo: string, lastSeq: number, count: number): { seq: number; barcode: string }[] | string {
  if (!Number.isInteger(count) || count < 1) return "จำนวน SN ต้องเป็นจำนวนเต็มตั้งแต่ 1";
  if (count > MAX_SERIALS_PER_BATCH) return `สร้างได้ครั้งละไม่เกิน ${MAX_SERIALS_PER_BATCH} SN`;
  if (lastSeq + count > MAX_SERIALS_PER_RECEIPT) {
    return `ใบนำเข้า 1 ใบมีได้ไม่เกิน ${MAX_SERIALS_PER_RECEIPT} SN (เหลือได้อีก ${Math.max(0, MAX_SERIALS_PER_RECEIPT - lastSeq)})`;
  }
  return Array.from({ length: count }, (_, i) => ({ seq: lastSeq + i + 1, barcode: serialBarcode(docNo, lastSeq + i + 1) }));
}

// ───────────── จำนวน (ทศนิยมไม่เกิน 3 ตำแหน่ง) ─────────────
// คำนวณเป็นหน่วย 1/1000 (จำนวนเต็ม) เพื่อเลี่ยงปัญหาทศนิยมของ float

const SCALE = 10 ** QTY_DECIMALS;

/** แปลงข้อความ/ตัวเลขเป็นจำนวน — null ถ้าไม่ใช่ตัวเลขหรือทศนิยมเกิน 3 ตำแหน่ง */
export function parseQty(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(v * SCALE - Math.round(v * SCALE)) < 1e-6 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d{1,3})?$/.test(s)) return null;
  return Number(s);
}

export const toMilli = (n: number | string) => Math.round(Number(n) * SCALE);
export const fromMilli = (m: number) => m / SCALE;
/** บวกจำนวนแบบไม่มีเศษ float */
export const sumQty = (xs: (number | string)[]) => fromMilli(xs.reduce<number>((s, x) => s + toMilli(x), 0));

/** สรุปยอดคงเหลือต่อ key จาก movement (+/−) และตัดรายการที่เหลือ 0 */
export function balancesBy<T>(rows: T[], key: (r: T) => string, qty: (r: T) => number | string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + toMilli(qty(r)));
  const out = new Map<string, number>();
  for (const [k, v] of m) if (v !== 0) out.set(k, fromMilli(v));
  return out;
}

/** ตรวจรายการนำออก: ห้ามเกินคงเหลือของ SN — คืน error ต่อ serialId */
export function checkIssueQuantities(
  lines: { serialId: string; quantity: number | string }[],
  balances: Map<string, number>,
): Record<string, string> {
  const want = balancesBy(lines, (l) => l.serialId, (l) => l.quantity);
  const errors: Record<string, string> = {};
  for (const l of lines) {
    if (toMilli(l.quantity) <= 0) errors[l.serialId] = "จำนวนต้องมากกว่า 0";
  }
  for (const [serialId, q] of want) {
    if (errors[serialId]) continue;
    const bal = balances.get(serialId) ?? 0;
    if (toMilli(q) > toMilli(bal)) errors[serialId] = `เกินคงเหลือ (คงเหลือ ${bal.toLocaleString("en-US", { maximumFractionDigits: QTY_DECIMALS })})`;
  }
  return errors;
}

/** "YYYY-MM-DD" ของวันนี้ตามเวลาไทย */
export function todayBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** เก็บวันที่เอกสาร (@db.Date) เป็นเที่ยงคืน UTC ของวันนั้น */
export const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const dateOnlyString = (d: Date) => d.toISOString().slice(0, 10);
