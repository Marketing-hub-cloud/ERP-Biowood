import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { visibleMenu } from "@/lib/rbac";
import { fullName } from "@/lib/format";
import { fileUrl } from "@/lib/storage";
import { Header } from "@/components/layout/header";
import { SidebarBrand, SidebarNav } from "@/components/layout/sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const menu = visibleMenu(user.permissions);
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <SidebarBrand />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav menu={menu} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          menu={menu}
          notificationCount={unread}
          user={{ name: fullName(user), email: user.email, position: user.position, avatarUrl: fileUrl(user.avatarKey) }}
        />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
