import { requirePagePermission } from "@/lib/session";
import { getUserOptions } from "@/server/user-options";
import { PageHeader } from "@/components/page-header";
import { GroupForm } from "../group-form";

export const metadata = { title: "สร้างกลุ่มสิทธิ์" };

export default async function NewGroupPage() {
  await requirePagePermission("users.group", "create");
  const users = await getUserOptions();
  return (
    <>
      <PageHeader
        title="สร้างกลุ่มสิทธิ์"
        backHref="/users/groups"
        breadcrumbs={[{ label: "ผู้ใช้งาน" }, { label: "กำหนดสิทธิ์", href: "/users/groups" }, { label: "สร้างกลุ่มสิทธิ์" }]}
      />
      <GroupForm mode="create" users={users} canEdit />
    </>
  );
}
