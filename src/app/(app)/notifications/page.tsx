import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { NotificationsList } from "./notifications-list";

export const metadata = { title: "การแจ้งเตือน" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return (
    <>
      <PageHeader title="การแจ้งเตือน" breadcrumbs={[{ label: "การแจ้งเตือน" }]} />
      <NotificationsList
        initialUnread={unread}
        initial={items.map((n) => ({
          id: n.id,
          module: n.module,
          title: n.title,
          body: n.body,
          link: n.link,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
