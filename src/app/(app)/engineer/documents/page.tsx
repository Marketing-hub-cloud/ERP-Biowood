import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EngineerTable } from "./engineer-table";

export const metadata = { title: "ใบถอดแบบ/ติดตั้ง" };

export default async function EngineerDocsPage() {
  const user = await requirePagePermission("engineer.document", "view");
  return (
    <>
      <PageHeader
        title="ใบถอดแบบ/ติดตั้ง"
        breadcrumbs={[{ label: "ถอดแบบ/ติดตั้ง" }, { label: "ใบถอดแบบ/ติดตั้ง" }]}
        actions={
          can(user.permissions, "engineer.document", "create") && (
            <Button asChild>
              <Link href="/engineer/documents/new">
                <Plus /> สร้างใบถอดแบบ/ติดตั้ง
              </Link>
            </Button>
          )
        }
      />
      <EngineerTable />
    </>
  );
}
