import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDateTime, fullName } from "@/lib/format";
import { dateOnlyString } from "@/lib/stock-rules";
import { canActOnApproval, type ApprovalSnapshot } from "@/lib/approval";
import { getOrderDetail } from "@/server/purchase-orders";
import { getPurchaseFormOptions } from "@/server/purchase-common";
import { getApprovalConfig } from "@/server/approval";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocStatusBadge } from "@/app/(app)/inventory/_components/doc-status-badge";
import { ApprovalPanel, PurchaseStatusBadge, StatusStepper } from "../../_components/purchase-ui";
import { OrderForm } from "../order-form";

export default async function OrderDetailPage({ params }: PageProps<"/purchase/orders/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("purchase.order", "view");
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  const { doc: d, received, returned, history, receipts, returns } = detail;
  const [options, config] = await Promise.all([getPurchaseFormOptions(), getApprovalConfig("PO")]);
  const snapshot = d.approvalSnapshot as ApprovalSnapshot | null;
  const canApproveNow = canActOnApproval(
    { status: d.status, currentStep: d.currentStep, approvalRound: d.approvalRound, approvalSnapshot: snapshot },
    user.id,
    can(user.permissions, "purchase.order", "approve"),
  );
  const money = (x: { toString(): string }) => x.toString();

  return (
    <>
      <PageHeader
        title={`ใบสั่งซื้อ ${d.docNo}`}
        backHref="/purchase/orders"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบสั่งซื้อ", href: "/purchase/orders" }, { label: d.docNo }]}
        actions={
          <>
            <PurchaseStatusBadge docType="PO" status={d.status} />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              สร้างโดย {fullName(d.createdBy)} {formatDateTime(d.createdAt)}
            </span>
            <AuditHistory entityType="PurchaseOrder" entityId={d.id} />
          </>
        }
      />
      <div className="mb-4">
        <StatusStepper docType="PO" status={d.status} />
        {d.status === "CANCELLED" && (
          <p className="mt-2 text-sm text-destructive">
            ยกเลิกโดย {fullName(d.cancelledBy)} {formatDateTime(d.cancelledAt)} · เหตุผล: {d.cancelReason}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <OrderForm
          key={d.updatedAt.toISOString()}
          doc={{ id: d.id, docNo: d.docNo, status: d.status }}
          options={options}
          canEdit={can(user.permissions, "purchase.order", "edit")}
          canApproveNow={canApproveNow}
          canCancel={can(user.permissions, "purchase.order", "cancel")}
          canReceive={can(user.permissions, "inventory.receipt", "create")}
          canReturn={can(user.permissions, "purchase.return", "create")}
          initial={{
            docDate: dateOnlyString(d.docDate),
            deliveryDate: d.deliveryDate ? dateOnlyString(d.deliveryDate) : "",
            vendor: d.vendor,
            paymentTerms: d.paymentTerms ?? "",
            reference: d.reference ?? "",
            warehouseId: d.warehouseId ?? "",
            note: d.note ?? "",
            vatMode: d.vatMode,
            headerDiscount: Number(d.headerDiscount) ? money(d.headerDiscount) : "",
            lines: d.lines.map((l) => ({
              key: l.id,
              productId: l.productId,
              requestLineId: l.requestLineId,
              requestDocNo: l.requestLine?.request.docNo ?? null,
              quantity: l.quantity.toString(),
              unitPrice: money(l.unitPrice),
              discount: Number(l.discount) ? money(l.discount) : "",
              note: l.note ?? "",
              received: received.get(l.id) ?? 0,
              returned: returned.get(l.id) ?? 0,
            })),
          }}
        />
        <div className="space-y-4">
          <ApprovalPanel status={d.status} snapshot={snapshot} currentStep={d.currentStep} configPreview={config} history={history} />
          {(receipts.length > 0 || returns.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">เอกสารที่อ้างอิง</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {receipts.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <Link href={`/inventory/receipts/${r.id}`} className="font-mono text-primary hover:underline">
                        {r.docNo}
                      </Link>
                      <DocStatusBadge kind="receipt" status={r.status} />
                    </li>
                  ))}
                  {returns.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <Link href={`/purchase/returns/${r.id}`} className="font-mono text-primary hover:underline">
                        {r.docNo}
                      </Link>
                      <PurchaseStatusBadge docType="RT" status={r.status} />
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
