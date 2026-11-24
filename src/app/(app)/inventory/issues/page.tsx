import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { IssuesTable } from "./issues-table";

export const metadata = { title: "นำออก" };

export default async function IssuesPage() {
  const user = await requirePagePermission("inventory.issue", "view");
  return (
    <>
      <PageHeader
        title="นำออก"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "นำออก" }]}
        actions={
          can(user.permissions, "inventory.issue", "create") && (
            <Button asChild>
              <Link href="/inventory/issues/new">
                <Plus /> สร้างใบนำออก
              </Link>
            </Button>
          )
        }
      />
      <IssuesTable />
    </>
  );
}
