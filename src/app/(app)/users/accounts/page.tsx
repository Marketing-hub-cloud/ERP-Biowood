import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { UsersTable } from "./users-table";

export const metadata = { title: "บัญชีผู้ใช้" };

export default async function UsersPage() {
  const user = await requirePagePermission("users.account", "view");
  const [groups, departments] = await Promise.all([
    prisma.permissionGroup.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { department: { not: null } }, select: { department: true }, distinct: ["department"], orderBy: { department: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title="บัญชีผู้ใช้"
        breadcrumbs={[{ label: "ผู้ใช้งาน" }, { label: "บัญชีผู้ใช้" }]}
        actions={
          can(user.permissions, "users.account", "create") && (
            <Button asChild>
              <Link href="/users/accounts/new">
                <Plus /> สร้างผู้ใช้
              </Link>
            </Button>
          )
        }
      />
      <UsersTable groups={groups} departments={departments.map((d) => d.department!).filter(Boolean)} />
    </>
  );
}
