// อ่าน CSV (RFC 4180) ที่ Export จาก Excel / ระบบเดิม — ใช้กับสคริปต์ import ข้อมูลเก่า
// รองรับ: UTF-8 BOM, ช่องมี "..." / "" / ขึ้นบรรทัดใหม่, CRLF/LF, ตัวคั่น , หรือ ; หรือ tab (ตรวจจากหัวตาราง)

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = [",", ";", "\t"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // ตัดแถวว่างทั้งแถว (Excel ชอบมีท้ายไฟล์)
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** แถวข้อมูลเป็น object ตามหัวตาราง (ตัดช่องว่างหัว/ท้าย) — คืน header ด้วยเพื่อตรวจคอลัมน์ */
export function csvToRecords(input: string): { headers: string[]; records: Record<string, string>[] } {
  const [head = [], ...body] = parseCsv(input);
  const headers = head.map((h) => h.trim());
  return {
    headers,
    records: body.map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))),
  };
}

const YES = new Set(["ใช่", "y", "yes", "true", "1", "x", "✓", "มี"]);
const NO = new Set(["ไม่", "ไม่ใช่", "n", "no", "false", "0", "-", "ไม่มี"]);

/** ใช่/ไม่ → boolean ("" = fallback, ค่าอื่น = undefined → ผิดรูปแบบ) */
export function parseBool(v: string, fallback: boolean): boolean | undefined {
  const s = v.trim().toLowerCase();
  if (s === "") return fallback;
  if (YES.has(s)) return true;
  if (NO.has(s)) return false;
  return undefined;
}

/**
 * วันที่ → "YYYY-MM-DD" | null (ว่าง) | undefined (ผิดรูปแบบ)
 * รับ DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY, YYYY-MM-DD; ปี > 2400 ถือเป็น พ.ศ. (ลบ 543)
 */
export function parseDate(v: string): string | null | undefined {
  const s = v.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else {
    mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (!mt) return undefined;
    [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  }
  if (y > 2400) y -= 543;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

/** ตัวเลข (มี comma คั่นหลักพันได้) → number | null (ว่าง) | undefined (ผิดรูปแบบ) */
export function parseNumber(v: string): number | null | undefined {
  const s = v.trim().replace(/,/g, "");
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s);
}

/** แยกหลายค่าในช่องเดียว (คั่นด้วย , ; หรือขึ้นบรรทัดใหม่) */
export const splitList = (v: string) =>
  v
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
