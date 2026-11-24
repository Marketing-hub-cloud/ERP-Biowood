import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDateTime, fullName } from "@/lib/format";
import { dateOnlyString } from "@/lib/stock-rules";
import { canActOnApproval, type ApprovalSnapshot } from "@/lib/approval";
import { getRequestDetail } from "@/server/purchase-requests";
import { getPurchaseFormOptions } from "@/server/purchase-common";
import { getApprovalConfig } from "@/server/approval";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalPanel, PurchaseStatusBadge, StatusStepper } from "../../_components/purchase-ui";
import { RequestForm } from "../request-form";

export default async function RequestDetailPage({ params }: PageProps<"/purchase/requests/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("purchase.request", "view");
  const detail = await getRequestDetail(id);
  if (!detail) notFound();
  const { doc: d, ordered, history, orders } = detail;
  const [options, config] = await Promise.all([getPurchaseFormOptions(), getApprovalConfig("PR")]);
  const snapshot = d.approvalSnapshot as ApprovalSnapshot | null;
  const canApproveNow = canActOnApproval(
    { status: d.status, currentStep: d.currentStep, approvalRound: d.approvalRound, approvalSnapshot: snapshot },
    user.id,
    can(user.permissions, "purchase.request", "approve"),
  );

  return (
    <>
      <PageHeader
        title={`ใบขอซื้อ ${d.docNo}`}
        backHref="/purchase/requests"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบขอซื้อ", href: "/purchase/requests" }, { label: d.docNo }]}
        actions={
          <>
            <PurchaseStatusBadge docType="PR" status={d.status} />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              สร้างโดย {fullName(d.createdBy)} {formatDateTime(d.createdAt)}
            </span>
            <AuditHistory entityType="PurchaseRequest" entityId={d.id} />
          </>
        }
      />
      <div className="mb-4">
        <StatusStepper docType="PR" status={d.status} />
        {d.status === "CANCELLED" && (
          <p className="mt-2 text-sm text-destructive">
            ยกเลิกโดย {fullName(d.cancelledBy)} {formatDateTime(d.cancelledAt)} · เหตุผล: {d.cancelReason}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <RequestForm
          key={d.updatedAt.toISOString()}
          doc={{ id: d.id, docNo: d.docNo, status: d.status }}
          options={options}
          canEdit={can(user.permissions, "purchase.request", "edit")}
          canApproveNow={canApproveNow}
          canCancel={can(user.permissions, "purchase.request", "cancel")}
          canCreateOrder={can(user.permissions, "purchase.order", "create")}
          initial={{
            docDate: dateOnlyString(d.docDate),
            requiredDate: d.requiredDate ? dateOnlyString(d.requiredDate) : "",
            requesterId: d.requesterId,
            department: d.department ?? "",
            position: d.position ?? "",
            reference: d.reference ?? "",
            warehouseId: d.warehouseId ?? "",
            note: d.note ?? "",
            lines: d.lines.map((l) => ({ key: l.id, productId: l.productId, quantity: l.quantity.toString(), note: l.note ?? "", ordered: ordered.get(l.id) ?? 0 })),
          }}
        />
        <div className="space-y-4">
          <ApprovalPanel status={d.status} snapshot={snapshot} currentStep={d.currentStep} configPreview={config} history={history} />
          {orders.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ใบสั่งซื้อที่อ้างอิง</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {orders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2">
                      <Link href={`/purchase/orders/${o.id}`} className="font-mono text-primary hover:underline">
                        {o.docNo}
                      </Link>
                      <PurchaseStatusBadge docType="PO" status={o.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
