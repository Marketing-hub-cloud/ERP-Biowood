// สูตรราคาใบสั่งซื้อ (ผู้ใช้เลือก "ตามแนะนำ" — ดู docs/DECISIONS.md เฟส 5)
// - ยอดต่อรายการ = ปัด 2 ตำแหน่ง(จำนวน × ราคาต่อหน่วย) − ส่วนลดของรายการ (บาท)
// - รวมเป็นเงิน = ผลรวมรายการ − ส่วนลดท้ายบิล (บาท)
// - VAT: แยกนอก = รวม × อัตรา% / รวมใน = รวม × อัตรา/(100+อัตรา) / ไม่มี VAT
// - ปัดเศษ 2 ตำแหน่งแบบครึ่งขึ้น (half-up) ทุกจุด, ไม่มีหัก ณ ที่จ่าย
// คำนวณด้วย BigInt (สตางค์ / หน่วยย่อย) ไม่ใช้ float

export type VatMode = "EXCLUSIVE" | "INCLUSIVE" | "NONE";
export const VAT_MODE_LABELS: Record<VatMode, string> = { EXCLUSIVE: "VAT แยกนอก", INCLUSIVE: "VAT รวมใน", NONE: "ไม่มี VAT" };
export const DEFAULT_VAT_RATE = 7;

type Num = number | string;

// ค่าคงที่ BigInt (tsconfig target < ES2020 จึงเขียน 0n ตรงๆ ไม่ได้)
const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B10 = BigInt(10);
const B10000 = BigInt(10000);

/** แปลงตัวเลขเป็น BigInt ที่ scale 10^d (ตัดทศนิยมเกิน d ด้วยการปัดครึ่งขึ้น) */
function toScaled(v: Num, d: number): bigint {
  const s = String(v).replace(/,/g, "").trim() || "0";
  const neg = s.startsWith("-");
  const [int, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const padded = (frac + "0".repeat(d + 1)).slice(0, d + 1);
  let n = BigInt(int || "0") * B10 ** BigInt(d) + BigInt(padded.slice(0, d) || "0");
  if (Number(padded[d] ?? "0") >= 5) n += B1;
  return neg ? -n : n;
}

/** หาร a/b แล้วปัดครึ่งขึ้น (a, b ≥ 0) */
function divRound(a: bigint, b: bigint): bigint {
  return (a * B2 + b) / (b * B2);
}

const satangToNumber = (n: bigint) => Number(n) / 100;

export type CalcLine = { quantity: Num; unitPrice: Num; discount?: Num };
export type CalcInput = { lines: CalcLine[]; headerDiscount?: Num; vatMode: VatMode; vatRate?: Num };
export type CalcResult = {
  lineAmounts: number[];
  /** รวมเป็นเงิน (ผลรวมรายการ) */
  subtotal: number;
  headerDiscount: number;
  /** หลังหักส่วนลดท้ายบิล */
  afterDiscount: number;
  /** มูลค่าก่อน VAT */
  beforeVat: number;
  vatAmount: number;
  total: number;
  errors: string[];
};

/** ยอดรายการเป็นสตางค์: round2(qty × price) − discount */
function lineSatang(l: CalcLine): bigint {
  const qty = toScaled(l.quantity, 3); // ×1000
  const price = toScaled(l.unitPrice, 4); // ×10000
  const gross = divRound(qty * price, B10 ** BigInt(5)); // → สตางค์ (×100)
  return gross - toScaled(l.discount ?? 0, 2);
}

export function calcPurchaseOrder(input: CalcInput): CalcResult {
  const errors: string[] = [];
  const amounts = input.lines.map(lineSatang);
  amounts.forEach((a, i) => {
    if (a < B0) errors.push(`รายการที่ ${i + 1}: ส่วนลดมากกว่ายอดของรายการ`);
  });
  const subtotal = amounts.reduce((s, a) => s + a, B0);
  const headerDiscount = toScaled(input.headerDiscount ?? 0, 2);
  if (headerDiscount < B0) errors.push("ส่วนลดท้ายบิลต้องไม่ติดลบ");
  const afterDiscount = subtotal - headerDiscount;
  if (afterDiscount < B0) errors.push("ส่วนลดท้ายบิลมากกว่ารวมเป็นเงิน");

  const rate = toScaled(input.vatRate ?? DEFAULT_VAT_RATE, 2); // ×100 เช่น 7% = 700
  const base = afterDiscount < B0 ? B0 : afterDiscount;
  let vat = B0;
  let total = base;
  let beforeVat = base;
  if (input.vatMode === "EXCLUSIVE") {
    vat = divRound(base * rate, B10000);
    total = base + vat;
  } else if (input.vatMode === "INCLUSIVE") {
    vat = divRound(base * rate, B10000 + rate);
    beforeVat = base - vat;
  }
  return {
    lineAmounts: amounts.map(satangToNumber),
    subtotal: satangToNumber(subtotal),
    headerDiscount: satangToNumber(headerDiscount),
    afterDiscount: satangToNumber(afterDiscount),
    beforeVat: satangToNumber(beforeVat),
    vatAmount: satangToNumber(vat),
    total: satangToNumber(total),
    errors,
  };
}

/** แสดงเงินบาท 2 ตำแหน่งเสมอ เช่น 12,840.00 */
export function formatMoney(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isNaN(n) ? "" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
