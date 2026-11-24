// LINE Messaging API (push message ไปที่ groupId) — ไม่ใช้ LINE Notify ซึ่งปิดบริการแล้ว
// ค่าลับอยู่ใน env เท่านั้น: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
import { createHmac, timingSafeEqual } from "node:crypto";

/** เปลี่ยนได้เพื่อทดสอบกับ LINE จำลอง */
export const lineApiBase = () => (process.env.LINE_API_BASE ?? "https://api.line.me").replace(/\/$/, "");
export const lineConfigured = () => Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim());

export type PushResult = { ok: true } | { ok: false; retryable: boolean; error: string };
type Fetch = typeof fetch;

/** LINE จำกัดข้อความ text ไม่เกิน 5,000 ตัวอักษร */
export const MAX_LINE_TEXT = 5000;

/**
 * ส่งข้อความ text ไปยังกลุ่ม
 * - 2xx = สำเร็จ, 409 = LINE รับ retry key นี้ไปแล้ว (ถือว่าสำเร็จ)
 * - 429 / 5xx / network / timeout = ลองใหม่ได้
 * - 4xx อื่น (token ผิด, groupId ผิด, บอทไม่อยู่ในกลุ่ม) = ผิดถาวร ไม่ต้องลองใหม่
 */
export async function pushText(to: string, text: string, opts: { retryKey?: string; fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<PushResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) return { ok: false, retryable: true, error: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN" };
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await f(`${lineApiBase()}/v2/bot/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts.retryKey ? { "X-Line-Retry-Key": opts.retryKey } : {}),
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, MAX_LINE_TEXT) }] }),
      signal: ctrl.signal,
    });
    if (res.ok || res.status === 409) return { ok: true };
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    return { ok: false, retryable, error: `LINE ${res.status}${detail ? `: ${detail}` : ""}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, retryable: true, error: aborted ? "หมดเวลารอ LINE (timeout)" : `เชื่อมต่อ LINE ไม่ได้: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** ตรวจลายเซ็น webhook: base64(HMAC-SHA256(channelSecret, rawBody)) ต้องตรงกับ header x-line-signature */
export function verifyLineSignature(rawBody: string, signature: string | null, secret = process.env.LINE_CHANNEL_SECRET ?? ""): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** ชื่อกลุ่ม (ใช้แสดงในหน้าตั้งค่า) — ไม่ได้ก็คืน null */
export async function lineGroupName(groupId: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) return null;
  try {
    const res = await fetchImpl(`${lineApiBase()}/v2/bot/group/${encodeURIComponent(groupId)}/summary`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const d = (await res.json()) as { groupName?: string };
    return d.groupName ?? null;
  } catch {
    return null;
  }
}
