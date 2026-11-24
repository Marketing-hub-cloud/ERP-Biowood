import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ReceiptsTable } from "./receipts-table";

export const metadata = { title: "นำเข้า" };

export default async function ReceiptsPage() {
  const user = await requirePagePermission("inventory.receipt", "view");
  const warehouses = await prisma.stockLocation.findMany({ where: { level: 0 }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  return (
    <>
      <PageHeader
        title="นำเข้า"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "นำเข้า" }]}
        actions={
          can(user.permissions, "inventory.receipt", "create") && (
            <Button asChild>
              <Link href="/inventory/receipts/new">
                <Plus /> สร้างใบนำเข้า
              </Link>
            </Button>
          )
        }
      />
      <ReceiptsTable warehouses={warehouses.map((w) => ({ value: w.id, label: `${w.code} ${w.name}` }))} />
    </>
  );
}
