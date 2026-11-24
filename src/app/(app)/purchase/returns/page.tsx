import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ReturnsTable } from "./returns-table";

export const metadata = { title: "ใบส่งคืน" };

export default async function ReturnsPage() {
  const user = await requirePagePermission("purchase.return", "view");
  return (
    <>
      <PageHeader
        title="ใบส่งคืน"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบส่งคืน" }]}
        actions={
          can(user.permissions, "purchase.return", "create") && (
            <Button asChild>
              <Link href="/purchase/returns/new">
                <Plus /> สร้างใบส่งคืน
              </Link>
            </Button>
          )
        }
      />
      <ReturnsTable />
    </>
  );
}
