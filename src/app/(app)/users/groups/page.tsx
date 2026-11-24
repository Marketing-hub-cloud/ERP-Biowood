import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { GroupsTable } from "./groups-table";

export const metadata = { title: "กำหนดสิทธิ์" };

export default async function GroupsPage() {
  const user = await requirePagePermission("users.group", "view");
  return (
    <>
      <PageHeader
        title="กำหนดสิทธิ์"
        breadcrumbs={[{ label: "ผู้ใช้งาน" }, { label: "กำหนดสิทธิ์" }]}
        actions={
          can(user.permissions, "users.group", "create") && (
            <Button asChild>
              <Link href="/users/groups/new">
                <Plus /> สร้างกลุ่มสิทธิ์
              </Link>
            </Button>
          )
        }
      />
      <GroupsTable />
    </>
  );
}
