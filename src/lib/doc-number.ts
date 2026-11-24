// เลขที่เอกสาร: PREFIX + YYMMDD + ลำดับ 4 หลัก รีเซ็ตทุกวัน (ตามเวลา Asia/Bangkok)
import { bangkokParts } from "./format";
import type { DbClient, TxClient } from "./db";

export const DOC_PREFIXES = {
  PURCHASE_REQUEST: "PR",
  PURCHASE_ORDER: "PO",
  PURCHASE_RETURN: "RT",
  GOODS_RECEIPT: "GR",
  GOODS_ISSUE: "GI",
  ENGINEER: "EN",
} as const;
export type DocPrefix = (typeof DOC_PREFIXES)[keyof typeof DOC_PREFIXES];
export const ALL_DOC_PREFIXES = Object.values(DOC_PREFIXES) as string[];

export function dateKey(date: Date = new Date()): string {
  const p = bangkokParts(date);
  return `${p.year.slice(2)}${p.month}${p.day}`;
}

export function formatDocNumber(prefix: string, key: string, seq: number): string {
  if (seq > 9999) throw new Error(`เลขที่เอกสาร ${prefix}${key} เกิน 9999 ใบต่อวัน`);
  return `${prefix}${key}${String(seq).padStart(4, "0")}`;
}

/**
 * ออกเลขที่เอกสารจริง — เรียกภายใน transaction เดียวกับการบันทึกเอกสาร
 * ใช้ INSERT ... ON CONFLICT DO UPDATE ซึ่ง atomic และ lock แถว counter จนจบ transaction
 * จึงไม่มีทางได้เลขซ้ำแม้สร้างพร้อมกัน
 */
export async function allocateDocNumber(tx: TxClient | DbClient, prefix: string, date: Date = new Date()): Promise<string> {
  const key = dateKey(date);
  const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
    INSERT INTO "document_counters" ("prefix", "dateKey", "lastSeq")
    VALUES (${prefix}, ${key}, 1)
    ON CONFLICT ("prefix", "dateKey")
    DO UPDATE SET "lastSeq" = "document_counters"."lastSeq" + 1
    RETURNING "lastSeq"
  `;
  return formatDocNumber(prefix, key, Number(rows[0].lastSeq));
}

/**
 * ลำดับเลขแบบไม่รีเซ็ตรายวัน (เช่น รหัสผู้ติดต่อ CT00001)
 * ใช้ตาราง counter เดียวกัน โดย dateKey = "" — atomic เหมือนเลขที่เอกสาร
 */
export async function allocateRunningCode(tx: TxClient | DbClient, prefix: string, digits = 5): Promise<string> {
  const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
    INSERT INTO "document_counters" ("prefix", "dateKey", "lastSeq")
    VALUES (${prefix}, '', 1)
    ON CONFLICT ("prefix", "dateKey")
    DO UPDATE SET "lastSeq" = "document_counters"."lastSeq" + 1
    RETURNING "lastSeq"
  `;
  return `${prefix}${String(Number(rows[0].lastSeq)).padStart(digits, "0")}`;
}

/** เลขถัดไป (แสดงในฟอร์มเท่านั้น ไม่จองเลข) */
export async function previewDocNumber(db: DbClient, prefix: string, date: Date = new Date()): Promise<string> {
  const key = dateKey(date);
  const row = await db.documentCounter.findUnique({ where: { prefix_dateKey: { prefix, dateKey: key } } });
  return formatDocNumber(prefix, key, (row?.lastSeq ?? 0) + 1);
}
