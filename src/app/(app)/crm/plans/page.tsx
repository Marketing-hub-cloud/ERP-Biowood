import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { todayBangkok } from "@/lib/stock-rules";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { PlansView } from "./plans-view";

export const metadata = { title: "แผนการทำงาน" };

export default async function PlansPage() {
  const user = await requirePagePermission("crm.plan", "view");
  const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } });
  return (
    <>
      <PageHeader
        title="แผนการทำงาน"
        breadcrumbs={[{ label: "การขาย (CRM)" }, { label: "แผนการทำงาน" }]}
        actions={
          can(user.permissions, "crm.plan", "create") && (
            <Button asChild>
              <Link href="/crm/plans/new">
                <Plus /> สร้างแผน
              </Link>
            </Button>
          )
        }
      />
      <PlansView employees={[{ value: "me", label: "ของฉัน" }, ...users.map((u) => ({ value: u.id, label: fullName(u) }))]} today={todayBangkok()} />
    </>
  );
}
