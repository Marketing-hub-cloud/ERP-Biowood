import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";
import { todayBangkok } from "@/lib/stock-rules";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { DeliveriesView } from "./deliveries-view";

export const metadata = { title: "ตารางงานพนักงานส่ง" };

export default async function DeliveriesPage() {
  const user = await requirePagePermission("inventory.delivery", "view");
  const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" } });
  return (
    <>
      <PageHeader
        title="ตารางงานพนักงานส่ง"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "ตารางงานพนักงานส่ง" }]}
        actions={
          can(user.permissions, "inventory.delivery", "create") && (
            <Button asChild>
              <Link href="/inventory/deliveries/new">
                <Plus /> สร้างงานจัดส่ง
              </Link>
            </Button>
          )
        }
      />
      <DeliveriesView drivers={[{ value: "me", label: "ของฉัน" }, ...users.map((u) => ({ value: u.id, label: fullName(u) }))]} today={todayBangkok()} />
    </>
  );
}
