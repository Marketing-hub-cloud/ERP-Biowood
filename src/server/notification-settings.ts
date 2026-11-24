import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { fullName, formatDateTime } from "@/lib/format";
import { lineConfigured } from "@/lib/line";
import { appBaseUrl, enqueueLine, NOTIFY_MODULES, type NotifyModule } from "@/lib/notifications";
import { kickNotificationWorker } from "@/lib/notification-worker";
import type { CurrentUser } from "@/lib/session";

export const ENTITY_NOTIFICATION_SETTING = "NotificationSetting";

export async function getNotificationSettings() {
  const [settings, groups] = await Promise.all([
    prisma.notificationSetting.findMany(),
    prisma.lineGroup.findMany({ where: { leftAt: null }, orderBy: { joinedAt: "desc" } }),
  ]);
  return {
    tokenConfigured: lineConfigured(),
    secretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET?.trim()),
    baseUrl: appBaseUrl(),
    baseUrlConfigured: Boolean(process.env.APP_BASE_URL?.trim()),
    modules: (Object.keys(NOTIFY_MODULES) as NotifyModule[]).map((m) => {
      const s = settings.find((x) => x.module === m);
      return {
        module: m,
        label: NOTIFY_MODULES[m].label,
        suggestedGroup: NOTIFY_MODULES[m].lineGroup,
        lineEnabled: s?.lineEnabled ?? false,
        lineGroupId: s?.lineGroupId ?? null,
        lineGroupName: s?.lineGroupName ?? null,
      };
    }),
    groups: groups.map((g) => ({ groupId: g.groupId, name: g.name, joinedAt: g.joinedAt.toISOString() })),
  };
}
export type NotificationSettingsView = Awaited<ReturnType<typeof getNotificationSettings>>;

export async function saveNotificationSetting(
  actor: CurrentUser,
  module: NotifyModule,
  d: { lineEnabled: boolean; lineGroupId: string | null },
  ip: string | null,
) {
  if (d.lineEnabled && !d.lineGroupId) throw new ApiError(400, "กรุณาเลือกหรือกรอก groupId ของกลุ่ม LINE", { lineGroupId: "กรุณาระบุกลุ่ม LINE" });
  await prisma.$transaction(async (tx) => {
    const before = await tx.notificationSetting.findUnique({ where: { module } });
    const group = d.lineGroupId ? await tx.lineGroup.findUnique({ where: { groupId: d.lineGroupId } }) : null;
    const data = { lineEnabled: d.lineEnabled, lineGroupId: d.lineGroupId, lineGroupName: group?.name ?? (d.lineGroupId === before?.lineGroupId ? before?.lineGroupName : null) ?? null, updatedById: actor.id };
    const after = await tx.notificationSetting.upsert({ where: { module }, create: { module, ...data }, update: data });
    const snap = (s: typeof after | null) => (s ? { lineEnabled: s.lineEnabled, lineGroup: s.lineGroupName ? `${s.lineGroupName} (${s.lineGroupId})` : s.lineGroupId } : null);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_NOTIFICATION_SETTING, entityId: module, action: before ? "UPDATE" : "CREATE", before: snap(before), after: snap(after), ip });
  });
}

/** ส่งข้อความทดสอบเข้ากลุ่มของโมดูล */
export async function sendTestMessage(actor: CurrentUser, module: NotifyModule) {
  const text = `[${NOTIFY_MODULES[module].label}] ทดสอบการแจ้งเตือนจาก Biowood ERP\nโดย: ${fullName(actor)}\nเวลา: ${formatDateTime(new Date())}\n${appBaseUrl()}/settings/notifications`;
  const id = await enqueueLine(prisma, module, text, { refType: "TEST" });
  if (!id) throw new ApiError(400, "กรุณาเปิดใช้ LINE และเลือกกลุ่มของโมดูลนี้ แล้วกดบันทึกก่อน");
  kickNotificationWorker();
  return { id, tokenConfigured: lineConfigured() };
}

/** ส่งซ้ำ: ให้โอกาสใหม่ครบทุกครั้ง */
export async function retryDelivery(id: string) {
  const d = await prisma.notificationDelivery.findUnique({ where: { id } });
  if (!d) throw new ApiError(404, "ไม่พบรายการ");
  if (d.status === "SENT" || d.status === "SENDING") throw new ApiError(409, d.status === "SENT" ? "รายการนี้ส่งสำเร็จแล้ว" : "รายการนี้กำลังส่งอยู่");
  await prisma.notificationDelivery.update({ where: { id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lockedAt: null } });
  kickNotificationWorker();
}
