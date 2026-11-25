import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ProjectsTable } from "./projects-table";

export const metadata = { title: "โครงการ" };

export default async function ProjectsPage() {
  const user = await requirePagePermission("crm.project", "view");
  const [users, tags] = await Promise.all([
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } }),
    prisma.tag.findMany({ where: { projects: { some: {} } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title="โครงการ"
        breadcrumbs={[{ label: "การขาย (CRM)" }, { label: "โครงการ" }]}
        actions={
          can(user.permissions, "crm.project", "create") && (
            <Button asChild>
              <Link href="/crm/projects/new">
                <Plus /> สร้างโครงการ
              </Link>
            </Button>
          )
        }
      />
      <ProjectsTable
        salesReps={[{ value: "me", label: "ของฉัน" }, ...users.map((u) => ({ value: u.id, label: fullName(u) }))]}
        tags={tags.map((t) => ({ value: t.id, label: t.name }))}
      />
    </>
  );
}
