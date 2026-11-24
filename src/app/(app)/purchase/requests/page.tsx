import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { RequestsTable } from "./requests-table";

export const metadata = { title: "ใบขอซื้อ" };

export default async function RequestsPage() {
  const user = await requirePagePermission("purchase.request", "view");
  return (
    <>
      <PageHeader
        title="ใบขอซื้อ"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบขอซื้อ" }]}
        actions={
          can(user.permissions, "purchase.request", "create") && (
            <Button asChild>
              <Link href="/purchase/requests/new">
                <Plus /> สร้างใบขอซื้อ
              </Link>
            </Button>
          )
        }
      />
      <RequestsTable />
    </>
  );
}
