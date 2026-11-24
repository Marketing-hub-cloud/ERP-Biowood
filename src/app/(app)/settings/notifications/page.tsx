import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { getNotificationSettings } from "@/server/notification-settings";
import { PageHeader } from "@/components/page-header";
import { NotificationSettings } from "./notification-settings";

export const metadata = { title: "การแจ้งเตือน" };

export default async function NotificationSettingsPage() {
  const user = await requirePagePermission("settings.notification", "view");
  const data = await getNotificationSettings();
  return (
    <>
      <PageHeader title="การแจ้งเตือน" breadcrumbs={[{ label: "ตั้งค่า" }, { label: "การแจ้งเตือน" }]} />
      <NotificationSettings initial={data} canEdit={can(user.permissions, "settings.notification", "edit")} />
    </>
  );
}
