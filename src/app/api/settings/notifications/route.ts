import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import { notificationSettingSchema } from "@/lib/validators";
import { getNotificationSettings, saveNotificationSetting } from "@/server/notification-settings";
import type { Prisma } from "@/generated/prisma/client";

export type DeliveryRow = {
  id: string;
  module: string;
  target: string;
  message: string;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED";
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
};

/**
 * ?view=deliveries → ประวัติการส่ง LINE (DataTable: f_status, f_module, q)
 * ไม่ระบุ → การตั้งค่าทุกโมดูล + สถานะ token + กลุ่มที่บอทเข้าร่วม
 */
export const GET = apiHandler({ perm: ["settings.notification", "view"] }, async ({ req }) => {
  if (req.nextUrl.searchParams.get("view") !== "deliveries") return getNotificationSettings();
  const p = parseListParams(req, ["createdAt"]);
  const and: Prisma.NotificationDeliveryWhereInput[] = [];
  const st = ["PENDING", "SENDING", "SENT", "FAILED"].find((s) => s === p.filters.status) as DeliveryRow["status"] | undefined;
  if (st) and.push({ status: st });
  if (p.filters.module) and.push({ module: p.filters.module });
  if (p.q) and.push({ OR: [{ message: { contains: p.q, mode: "insensitive" } }, { lastError: { contains: p.q, mode: "insensitive" } }] });
  const where = { AND: and };
  if (p.format === "csv") {
    const all = await prisma.notificationDelivery.findMany({ where, orderBy: { createdAt: "desc" }, take: 10_000 });
    const label = { PENDING: "รอส่ง", SENDING: "กำลังส่ง", SENT: "ส่งแล้ว", FAILED: "ส่งไม่สำเร็จ" } as const;
    return csvResponse(
      toCsv(all, [
        { header: "เวลา", value: (r) => formatDateTime(r.createdAt) },
        { header: "โมดูล", value: (r) => r.module },
        { header: "กลุ่ม", value: (r) => r.target },
        { header: "ข้อความ", value: (r) => r.message },
        { header: "สถานะ", value: (r) => label[r.status] },
        { header: "จำนวนครั้ง", value: (r) => r.attempts },
        { header: "ส่งสำเร็จเมื่อ", value: (r) => formatDateTime(r.sentAt) },
        { header: "สาเหตุ", value: (r) => r.lastError },
      ]),
      "line-deliveries.csv",
    );
  }
  const [total, rows] = await Promise.all([
    prisma.notificationDelivery.count({ where }),
    prisma.notificationDelivery.findMany({ where, orderBy: { createdAt: p.sort?.dir ?? "desc" }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): DeliveryRow => ({
        id: r.id,
        module: r.module,
        target: r.target,
        message: r.message,
        status: r.status,
        attempts: r.attempts,
        nextAttemptAt: r.nextAttemptAt.toISOString(),
        lastError: r.lastError,
        sentAt: r.sentAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<DeliveryRow>;
});

/** { module, lineEnabled, lineGroupId } */
export const PUT = apiHandler({ perm: ["settings.notification", "edit"] }, async ({ req, user, ip }) => {
  const d = notificationSettingSchema.parse(await readJson(req));
  await saveNotificationSetting(user, d.module, d, ip);
  return getNotificationSettings();
});
