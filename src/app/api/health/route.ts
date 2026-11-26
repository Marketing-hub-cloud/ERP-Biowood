import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** health check (ไม่ต้องล็อกอิน) สำหรับ Docker/monitoring — ตรวจว่าแอปต่อฐานข้อมูลได้ ไม่เปิดเผยรายละเอียด */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
