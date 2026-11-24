import { requirePagePermission } from "@/lib/session";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { UserForm } from "../user-form";

export const metadata = { title: "สร้างผู้ใช้" };

export default async function NewUserPage() {
  const user = await requirePagePermission("users.account", "create");
  const groups = await prisma.permissionGroup.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader
        title="สร้างผู้ใช้"
        backHref="/users/accounts"
        breadcrumbs={[{ label: "ผู้ใช้งาน" }, { label: "บัญชีผู้ใช้", href: "/users/accounts" }, { label: "สร้างผู้ใช้" }]}
      />
      <UserForm mode="create" groups={groups} canEdit actorIsAdmin={user.isAdmin} />
    </>
  );
}
