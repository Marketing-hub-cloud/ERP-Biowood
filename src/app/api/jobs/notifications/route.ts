import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processDueDeliveries } from "@/lib/notification-worker";

/**
 * ส่งคิว LINE 1 รอบ — สำหรับ cron ภายนอก (กรณีตั้ง NOTIFY_WORKER=off)
 * ต้องส่ง header Authorization: Bearer <CRON_SECRET>
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await processDueDeliveries());
}
