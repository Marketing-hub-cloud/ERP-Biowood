// Worker ส่งคิว LINE (outbox): จองแถวด้วย FOR UPDATE SKIP LOCKED (หลาย worker/หลาย instance ไม่ส่งซ้ำ)
// ส่งล้ม: ลองใหม่ตาม RETRY_DELAYS_MS; ผิดถาวร (เช่น groupId ผิด) หรือครบจำนวนครั้ง = FAILED
// ยังไม่ตั้ง token: ไม่แตะคิว (ข้อความรอจนกว่าจะตั้งค่า)
import { createHash } from "node:crypto";
import { prisma } from "./db";
import { lineConfigured, pushText } from "./line";
import { MAX_ATTEMPTS, nextAttemptAfter } from "./notifications";

/** แถว SENDING ที่ค้างนานเกินนี้ (worker ตายกลางทาง) ถือว่าว่าง */
const STALE_LOCK_MS = 5 * 60_000;
const INTERVAL_MS = 15_000;

/** UUID ที่คงที่ต่อคิว (X-Line-Retry-Key) — ถ้าส่งซ้ำหลัง timeout LINE จะไม่ส่งข้อความซ้ำ */
export function retryKeyFor(id: string): string {
  const h = createHash("sha1").update(`biowood-line:${id}`).digest("hex");
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** จองคิวที่ถึงเวลาส่ง */
export async function claimDue(limit = 20, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const stale = new Date(now.getTime() - STALE_LOCK_MS);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM notification_deliveries
      WHERE (status = 'PENDING' AND "nextAttemptAt" <= ${now}) OR (status = 'SENDING' AND "lockedAt" < ${stale})
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await tx.notificationDelivery.updateMany({ where: { id: { in: ids } }, data: { status: "SENDING", lockedAt: now } });
    return tx.notificationDelivery.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: "asc" } });
  });
}

export type ProcessResult = { skipped?: "no-token"; sent: number; retried: number; failed: number };

/** ส่งคิวที่ถึงเวลา 1 รอบ */
export async function processDueDeliveries(opts: { limit?: number; fetchImpl?: typeof fetch; now?: Date } = {}): Promise<ProcessResult> {
  if (!lineConfigured()) return { skipped: "no-token", sent: 0, retried: 0, failed: 0 };
  const result: ProcessResult = { sent: 0, retried: 0, failed: 0 };
  const claimed = await claimDue(opts.limit ?? 20, opts.now);
  for (const d of claimed) {
    const res = await pushText(d.target, d.message, { retryKey: retryKeyFor(d.id), fetchImpl: opts.fetchImpl });
    const attempts = d.attempts + 1;
    if (res.ok) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SENT", attempts, sentAt: new Date(), lockedAt: null, lastError: null } });
      result.sent++;
      continue;
    }
    const next = res.retryable ? nextAttemptAfter(attempts) : null;
    if (next) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "PENDING", attempts, nextAttemptAt: next, lockedAt: null, lastError: res.error } });
      result.retried++;
    } else {
      const why = res.retryable ? `${res.error} (ลองครบ ${MAX_ATTEMPTS} ครั้งแล้ว)` : res.error;
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "FAILED", attempts, lockedAt: null, lastError: why } });
      result.failed++;
    }
  }
  return result;
}

// ───────────── รันในแอป (เริ่มจาก src/instrumentation.ts) ─────────────

type WorkerState = { timer?: ReturnType<typeof setInterval>; running: boolean; kick?: ReturnType<typeof setTimeout> };
const g = globalThis as unknown as { __notifyWorker?: WorkerState };

async function tick() {
  const s = g.__notifyWorker;
  if (!s || s.running) return;
  s.running = true;
  try {
    // วนจนคิวที่ถึงเวลาหมด (ทีละ 20)
    for (let i = 0; i < 10; i++) {
      const r = await processDueDeliveries();
      if (r.skipped || r.sent + r.retried + r.failed < 20) break;
    }
  } catch (err) {
    console.error("[notify-worker]", err);
  } finally {
    s.running = false;
  }
}

export function startNotificationWorker() {
  if (g.__notifyWorker?.timer) return;
  g.__notifyWorker = { running: false };
  g.__notifyWorker.timer = setInterval(tick, INTERVAL_MS);
  void tick();
}

/** เรียกหลังบันทึกเอกสาร เพื่อส่ง LINE ทันทีไม่ต้องรอรอบ 15 วินาที */
export function kickNotificationWorker() {
  const s = g.__notifyWorker;
  if (!s) return;
  if (s.kick) clearTimeout(s.kick);
  s.kick = setTimeout(() => void tick(), 300);
}
