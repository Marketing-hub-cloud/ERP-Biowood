// รูปแบบการแสดงผล: วันที่ DD/MM/YYYY (ค.ศ.), เวลา HH:mm, timezone Asia/Bangkok, ตัวเลขมี comma
export const TIMEZONE = "Asia/Bangkok";

type DateInput = Date | string | number | null | undefined;

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** แยกส่วนของวันที่ตามเวลาไทย */
export function bangkokParts(v: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(v);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

export function formatDate(v: DateInput): string {
  const d = toDate(v);
  if (!d) return "";
  const p = bangkokParts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

export function formatTime(v: DateInput): string {
  const d = toDate(v);
  if (!d) return "";
  const p = bangkokParts(d);
  return `${p.hour}:${p.minute}`;
}

export function formatDateTime(v: DateInput): string {
  const d = toDate(v);
  return d ? `${formatDate(d)} ${formatTime(d)}` : "";
}

export function formatNumber(v: number | string | null | undefined, decimals?: number): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 2,
  });
}

export function fullName(u: { firstName: string; lastName: string } | null | undefined): string {
  return u ? `${u.firstName} ${u.lastName}`.trim() : "";
}
