import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { ProfileForm, PasswordForm } from "./profile-forms";

export const metadata = { title: "แก้ไขข้อมูลส่วนตัว" };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title="แก้ไขข้อมูลส่วนตัว"
        breadcrumbs={[{ label: "ผู้ใช้งาน" }, { label: "แก้ไขข้อมูลส่วนตัว" }]}
        actions={<AuditHistory entityType="User" entityId={user.id} />}
      />
      <div className="grid max-w-4xl gap-4">
        <ProfileForm
          email={user.email}
          initial={{ firstName: user.firstName, lastName: user.lastName, department: user.department ?? "", position: user.position ?? "" }}
        />
        <PasswordForm />
      </div>
    </>
  );
}
