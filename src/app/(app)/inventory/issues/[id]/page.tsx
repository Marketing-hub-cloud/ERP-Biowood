import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDateTime, fullName } from "@/lib/format";
import { dateOnlyString } from "@/lib/stock-rules";
import { getIssueDetail } from "@/server/goods-issues";
import { issuableReturns, openReturnLines } from "@/server/purchase-returns";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { DocStatusBadge } from "../../_components/doc-status-badge";
import { IssueForm } from "../issue-form";
import { IssueDeliveries } from "../issue-deliveries";

export default async function IssueDetailPage({ params }: PageProps<"/inventory/issues/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("inventory.issue", "view");
  const detail = await getIssueDetail(id);
  if (!detail) notFound();
  const { doc: d, lines } = detail;
  const isDraft = d.status === "DRAFT";
  const [returnOptions, rt] = await Promise.all([
    isDraft ? issuableReturns() : Promise.resolve([]),
    d.purchaseReturnId && isDraft ? openReturnLines(d.purchaseReturnId) : Promise.resolve(null),
  ]);
  const canEdit = can(user.permissions, "inventory.issue", "edit");
  const info =
    d.status === "POSTED"
      ? `นำออกโดย ${fullName(d.postedBy)} ${formatDateTime(d.postedAt)}`
      : d.status === "CANCELLED"
        ? `ยกเลิกโดย ${fullName(d.cancelledBy)} ${formatDateTime(d.cancelledAt)} · เหตุผล: ${d.cancelReason ?? "-"}`
        : `สร้างโดย ${fullName(d.createdBy)} ${formatDateTime(d.createdAt)}`;

  return (
    <>
      <PageHeader
        title={`ใบนำออก ${d.docNo}`}
        backHref="/inventory/issues"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "นำออก", href: "/inventory/issues" }, { label: d.docNo }]}
        actions={
          <>
            <DocStatusBadge kind="issue" status={d.status} />
            <span className="hidden text-xs text-muted-foreground sm:inline">{info}</span>
            <AuditHistory entityType="GoodsIssue" entityId={d.id} />
          </>
        }
      />
      <IssueForm
        key={d.updatedAt.toISOString()}
        canEdit={canEdit}
        canPost={canEdit}
        canCancel={can(user.permissions, "inventory.issue", "cancel")}
        returnOptions={returnOptions}
        issue={{
          id: d.id,
          docNo: d.docNo,
          status: d.status,
          values: {
            type: d.type,
            docDate: dateOnlyString(d.docDate),
            purchaseReturn: d.purchaseReturn ? { id: d.purchaseReturn.id, docNo: d.purchaseReturn.docNo, lines: rt?.lines ?? [] } : null,
            contact: d.contact,
            recipientName: d.recipientName ?? "",
            shippingAddress: d.shippingAddress ?? "",
            note: d.note ?? "",
            lines,
          },
        }}
      />
      {can(user.permissions, "inventory.delivery", "view") && (
        <IssueDeliveries issueId={d.id} canCreate={d.status !== "CANCELLED" && can(user.permissions, "inventory.delivery", "create")} />
      )}
    </>
  );
}
