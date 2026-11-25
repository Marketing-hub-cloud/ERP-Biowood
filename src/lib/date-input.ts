// แปลงวันที่ระหว่างช่องกรอก DD/MM/YYYY (ค.ศ.) กับค่า YYYY-MM-DD

/** "YYYY-MM-DD" -> "DD/MM/YYYY" */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "DD/MM/YYYY" (หรือ D/M/YYYY) -> "YYYY-MM-DD" | null ถ้าไม่ใช่วันที่จริง */
export function displayToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ───────────── วันเวลา (เวลาไทย) ─────────────
// ฟอร์มส่งวันเวลาเป็น "YYYY-MM-DDTHH:mm" ตามเวลาไทยเสมอ (ไม่ขึ้นกับ timezone ของเครื่อง/เซิร์ฟเวอร์)

const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "YYYY-MM-DDTHH:mm" (เวลาไทย) -> Date | null */
export function bangkokLocalToDate(s: string): Date | null {
  const m = LOCAL_DT.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (h > 23 || mi > 59) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, h - 7, mi));
  const back = new Date(dt.getTime() + 7 * 3600_000);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return dt;
}

/** Date -> "YYYY-MM-DDTHH:mm" ตามเวลาไทย (ไทยไม่มี daylight saving จึงบวก 7 ชม. ได้ตรงๆ) */
export function dateToBangkokLocal(d: Date | string): string {
  return new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 16);
}
