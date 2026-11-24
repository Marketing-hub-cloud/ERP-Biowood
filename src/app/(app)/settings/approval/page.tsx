import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { APPROVAL_DOC_TYPES, type ApprovalDocType } from "@/lib/approval";
import { getApprovalConfig } from "@/server/approval";
import { getUserOptions } from "@/server/user-options";
import { PageHeader } from "@/components/page-header";
import { ApprovalEditor } from "./approval-editor";

export const metadata = { title: "การอนุมัติ" };

export default async function ApprovalSettingsPage() {
  const user = await requirePagePermission("settings.approval", "view");
  const docTypes = Object.keys(APPROVAL_DOC_TYPES) as ApprovalDocType[];
  const [users, ...configs] = await Promise.all([getUserOptions(), ...docTypes.map((t) => getApprovalConfig(t))]);
  const canEdit = can(user.permissions, "settings.approval", "edit");
  return (
    <>
      <PageHeader title="การอนุมัติ" breadcrumbs={[{ label: "ตั้งค่า" }, { label: "การอนุมัติ" }, { label: "จัดซื้อ" }]} />
      <h2 className="mb-3 text-lg font-semibold">จัดซื้อ</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {docTypes.map((t, i) => (
          <ApprovalEditor
            key={t}
            docType={t}
            title={APPROVAL_DOC_TYPES[t].label}
            initial={configs[i].map((s) => ({ approvers: s.approvers.map((a) => ({ id: a.id, name: a.name })) }))}
            users={users.filter((u) => !u.inactive).map((u) => ({ id: u.id, name: u.name, department: u.department }))}
            canEdit={canEdit}
          />
        ))}
      </div>
    </>
  );
}
