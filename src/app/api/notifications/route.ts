import { apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";

export type NotificationItem = {
  id: string;
  module: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

/** แจ้งเตือนของผู้ใช้ที่ล็อกอิน: ?limit=10&before=<createdAt ISO>&unread=1 → { items, unread } */
export const GET = apiHandler({}, async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 10));
  const before = sp.get("before");
  const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, ...(sp.get("unread") === "1" ? { readAt: null } : {}), ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return {
    items: items.map(
      (n): NotificationItem => ({
        id: n.id,
        module: n.module,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      }),
    ),
    unread,
  };
});
