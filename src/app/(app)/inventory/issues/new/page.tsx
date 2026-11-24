import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { todayBangkok } from "@/lib/stock-rules";
import { PageHeader } from "@/components/page-header";
import { IssueForm } from "../issue-form";

export const metadata = { title: "สร้างใบนำออก" };

export default async function NewIssuePage() {
  const user = await requirePagePermission("inventory.issue", "create");
  return (
    <>
      <PageHeader
        title="สร้างใบนำออก"
        backHref="/inventory/issues"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "นำออก", href: "/inventory/issues" }, { label: "สร้างใบนำออก" }]}
      />
      <IssueForm
        issue={null}
        canEdit
        canPost={can(user.permissions, "inventory.issue", "edit")}
        canCancel={false}
        defaults={{ type: "SALE", docDate: todayBangkok(), contact: null, recipientName: "", shippingAddress: "", note: "", lines: [] }}
      />
    </>
  );
}
