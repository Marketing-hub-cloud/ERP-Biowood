import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { lineGroupName, verifyLineSignature } from "@/lib/line";

type LineEvent = { type: string; source?: { type?: string; groupId?: string } };

/**
 * Webhook ของ LINE (ไม่ต้องล็อกอิน แต่ต้องมีลายเซ็นถูกต้องจาก LINE_CHANNEL_SECRET)
 * จำกลุ่มที่บอทเข้าร่วม (join / ข้อความในกลุ่ม) เพื่อให้เลือก groupId ได้ในหน้า ตั้งค่า > การแจ้งเตือน
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get("x-line-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw) as { events?: LineEvent[] }).events ?? [];
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  for (const e of events) {
    const groupId = e.source?.type === "group" ? e.source.groupId : undefined;
    if (!groupId) continue;
    if (e.type === "leave") {
      await prisma.lineGroup.updateMany({ where: { groupId }, data: { leftAt: new Date() } });
      continue;
    }
    const existing = await prisma.lineGroup.findUnique({ where: { groupId } });
    if (existing && !existing.leftAt && existing.name) continue;
    const name = (await lineGroupName(groupId)) ?? existing?.name ?? null;
    await prisma.lineGroup.upsert({
      where: { groupId },
      create: { groupId, name },
      update: { name, leftAt: null, ...(existing?.leftAt ? { joinedAt: new Date() } : {}) },
    });
    if (name) await prisma.notificationSetting.updateMany({ where: { lineGroupId: groupId }, data: { lineGroupName: name } });
  }
  // LINE ต้องการ 200 เสมอเมื่อรับได้
  return NextResponse.json({ ok: true });
}
