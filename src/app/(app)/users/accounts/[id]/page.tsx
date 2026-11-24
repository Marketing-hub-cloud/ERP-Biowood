import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { Badge } from "@/components/ui/badge";
import { UserForm } from "../user-form";
import { UserStatusCard } from "./status-card";

export default async function EditUserPage({ params }: PageProps<"/users/accounts/[id]">) {
  const { id } = await params;
  const actor = await requirePagePermission("users.account", "view");
  const [u, groups] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { groups: { select: { groupId: true } } } }),
    prisma.permissionGroup.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!u) notFound();
  // บัญชี admin แก้ได้เฉพาะ admin
  const adminLocked = u.isAdmin && !actor.isAdmin;
  const canEdit = can(actor.permissions, "users.account", "edit") && !adminLocked;
  const canChangeStatus = can(actor.permissions, "users.account", "cancel") && !adminLocked && u.id !== actor.id;

  return (
    <>
      <PageHeader
        title={fullName(u)}
        backHref="/users/accounts"
        breadcrumbs={[{ label: "ผู้ใช้งาน" }, { label: "บัญชีผู้ใช้", href: "/users/accounts" }, { label: fullName(u) }]}
        actions={
          <>
            {u.status === "ACTIVE" ? (
              <Badge className="bg-emerald-100 text-emerald-800">ใช้งาน</Badge>
            ) : (
              <Badge variant="destructive">หยุดใช้งาน</Badge>
            )}
            <AuditHistory entityType="User" entityId={u.id} />
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <UserForm
          mode="edit"
          userId={u.id}
          groups={groups}
          canEdit={canEdit}
          actorIsAdmin={actor.isAdmin}
          initial={{
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            department: u.department ?? "",
            position: u.position ?? "",
            isAdmin: u.isAdmin,
            groupIds: u.groups.map((g) => g.groupId),
          }}
        />
        <UserStatusCard userId={u.id} status={u.status} statusNote={u.statusNote} canChange={canChangeStatus} />
      </div>
    </>
  );
}
