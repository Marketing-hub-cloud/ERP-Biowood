import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatDateTime, fullName } from "@/lib/format";
import { dateOnlyString } from "@/lib/stock-rules";
import { canActOnApproval, type ApprovalSnapshot } from "@/lib/approval";
import { getReturnDetail } from "@/server/purchase-returns";
import { returnableLines } from "@/server/purchase-orders";
import { getApprovalConfig } from "@/server/approval";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocStatusBadge } from "@/app/(app)/inventory/_components/doc-status-badge";
import { ApprovalPanel, PurchaseStatusBadge, StatusStepper } from "../../_components/purchase-ui";
import { ReturnForm } from "../return-form";
import { linesFromOrder } from "../return-values";

export default async function ReturnDetailPage({ params }: PageProps<"/purchase/returns/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("purchase.return", "view");
  const detail = await getReturnDetail(id);
  if (!detail) notFound();
  const { doc: d, issued, history, issues } = detail;
  const [config, order, reasons] = await Promise.all([
    getApprovalConfig("RT"),
    returnableLines(d.orderId, d.id),
    prisma.lookupOption.findMany({ where: { kind: "RETURN_REASON" }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
  ]);
  const snapshot = d.approvalSnapshot as ApprovalSnapshot | null;
  const canApproveNow = canActOnApproval(
    { status: d.status, currentStep: d.currentStep, approvalRound: d.approvalRound, approvalSnapshot: snapshot },
    user.id,
    can(user.permissions, "purchase.return", "approve"),
  );
  const current = new Map(d.lines.map((l) => [l.orderLineId, { quantity: l.quantity.toString(), note: l.note ?? "" }]));
  // ร่าง: แสดงทุกรายการที่คืนได้ / หลังส่งแล้ว: แสดงเฉพาะรายการในใบ
  const lines = linesFromOrder(order!, current)
    .filter((l) => d.status === "DRAFT" || current.has(l.orderLineId))
    .map((l) => ({ ...l, issued: issued.get(d.lines.find((x) => x.orderLineId === l.orderLineId)?.id ?? "") ?? 0 }));

  return (
    <>
      <PageHeader
        title={`ใบส่งคืน ${d.docNo}`}
        backHref="/purchase/returns"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบส่งคืน", href: "/purchase/returns" }, { label: d.docNo }]}
        actions={
          <>
            <PurchaseStatusBadge docType="RT" status={d.status} />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              สร้างโดย {fullName(d.createdBy)} {formatDateTime(d.createdAt)}
            </span>
            <AuditHistory entityType="PurchaseReturn" entityId={d.id} />
          </>
        }
      />
      <div className="mb-4">
        <StatusStepper docType="RT" status={d.status} />
        {d.status === "CANCELLED" && (
          <p className="mt-2 text-sm text-destructive">
            ยกเลิกโดย {fullName(d.cancelledBy)} {formatDateTime(d.cancelledAt)} · เหตุผล: {d.cancelReason}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <ReturnForm
          key={d.updatedAt.toISOString()}
          doc={{ id: d.id, docNo: d.docNo, status: d.status }}
          reasons={reasons.map((r) => ({ id: r.id, label: r.label, isActive: r.isActive }))}
          orderOptions={[]}
          canEdit={can(user.permissions, "purchase.return", "edit")}
          canApproveNow={canApproveNow}
          canCancel={can(user.permissions, "purchase.return", "cancel")}
          canIssue={can(user.permissions, "inventory.issue", "create")}
          initial={{
            docDate: dateOnlyString(d.docDate),
            orderId: d.orderId,
            orderDocNo: d.order.docNo,
            vendorName: d.vendor.name,
            reasonId: d.reasonId,
            note: d.note ?? "",
            lines,
          }}
        />
        <div className="space-y-4">
          <ApprovalPanel status={d.status} snapshot={snapshot} currentStep={d.currentStep} configPreview={config} history={history} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">เอกสารที่เกี่ยวข้อง</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                <li className="flex items-center justify-between gap-2">
                  <Link href={`/purchase/orders/${d.orderId}`} className="font-mono text-primary hover:underline">
                    {d.order.docNo}
                  </Link>
                  <PurchaseStatusBadge docType="PO" status={d.order.status} />
                </li>
                {issues.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <Link href={`/inventory/issues/${g.id}`} className="font-mono text-primary hover:underline">
                      {g.docNo}
                    </Link>
                    <DocStatusBadge kind="issue" status={g.status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
