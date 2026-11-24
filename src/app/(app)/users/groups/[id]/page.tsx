import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can, rowToFlags } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getUserOptions } from "@/server/user-options";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { GroupForm } from "../group-form";

export default async function EditGroupPage({ params }: PageProps<"/users/groups/[id]">) {
  const { id } = await params;
  const actor = await requirePagePermission("users.group", "view");
  const [g, users] = await Promise.all([
    prisma.permissionGroup.findUnique({ where: { id }, include: { permissions: true, members: { select: { userId: true } } } }),
    getUserOptions(),
  ]);
  if (!g) notFound();
  return (
    <>
      <PageHeader
        title={g.name}
        backHref="/users/groups"
        breadcrumbs={[{ label: "ผู้ใช้งาน" }, { label: "กำหนดสิทธิ์", href: "/users/groups" }, { label: g.name }]}
        actions={<AuditHistory entityType="PermissionGroup" entityId={g.id} />}
      />
      <GroupForm
        mode="edit"
        groupId={g.id}
        users={users}
        canEdit={can(actor.permissions, "users.group", "edit")}
        canDelete={can(actor.permissions, "users.group", "delete")}
        initial={{
          name: g.name,
          description: g.description ?? "",
          permissions: Object.fromEntries(g.permissions.map((p) => [p.menuKey, rowToFlags(p)])),
          memberIds: g.members.map((m) => m.userId),
        }}
      />
    </>
  );
}
