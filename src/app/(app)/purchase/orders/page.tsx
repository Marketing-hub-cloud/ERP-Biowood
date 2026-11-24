import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { OrdersTable } from "./orders-table";

export const metadata = { title: "ใบสั่งซื้อ" };

export default async function OrdersPage() {
  const user = await requirePagePermission("purchase.order", "view");
  return (
    <>
      <PageHeader
        title="ใบสั่งซื้อ"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบสั่งซื้อ" }]}
        actions={
          can(user.permissions, "purchase.order", "create") && (
            <Button asChild>
              <Link href="/purchase/orders/new">
                <Plus /> สร้างใบสั่งซื้อ
              </Link>
            </Button>
          )
        }
      />
      <OrdersTable />
    </>
  );
}
