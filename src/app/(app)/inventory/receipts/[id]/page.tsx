import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { formatDateTime, fullName } from "@/lib/format";
import { dateOnlyString } from "@/lib/stock-rules";
import { getStockFormOptions, receiptInclude } from "@/server/goods-receipts";
import { openOrderLines, receivableOrders } from "@/server/purchase-orders";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { DocStatusBadge } from "../../_components/doc-status-badge";
import { ReceiptForm, type ReceiptView } from "../receipt-form";

export default async function ReceiptDetailPage({ params }: PageProps<"/inventory/receipts/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("inventory.receipt", "view");
  const r = await prisma.goodsReceipt.findUnique({ where: { id }, include: receiptInclude });
  if (!r) notFound();
  const [options, orderOptions, open] = await Promise.all([
    getStockFormOptions(),
    r.status === "DRAFT" ? receivableOrders() : Promise.resolve([]),
    r.purchaseOrderId ? openOrderLines(r.purchaseOrderId) : Promise.resolve(null),
  ]);

  const view: ReceiptView = {
    id: r.id,
    docNo: r.docNo,
    status: r.status,
    type: r.type,
    purchaseOrderId: r.purchaseOrderId,
    orderDocNo: r.order?.docNo ?? null,
    docDate: dateOnlyString(r.docDate),
    warehouseId: r.warehouseId,
    lot: r.lot ?? "",
    note: r.note ?? "",
    lines: r.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      locationId: l.locationId,
      orderLineId: l.orderLineId,
      note: l.note ?? "",
      serials: l.serials.map((s) => ({ id: s.id, barcode: s.barcode, qty: Number(s.initialQty), scannedAt: s.scannedAt?.toISOString() ?? null })),
    })),
  };
  // สินค้าในใบที่ถูกปิด/ลบภายหลัง ต้องยังแสดงชื่อได้
  for (const l of r.lines) {
    if (!options.products.some((p) => p.id === l.productId)) {
      options.products.push({ id: l.product.id, code: l.product.code, name: l.product.name, isActive: false, unit: l.product.stockUnit?.name ?? "" });
    }
  }
  const serialCount = r.lines.reduce((n, l) => n + l.serials.length, 0);
  const info =
    r.status === "POSTED"
      ? `นำเข้าโดย ${fullName(r.postedBy)} ${formatDateTime(r.postedAt)}`
      : r.status === "CANCELLED"
        ? `ยกเลิกโดย ${fullName(r.cancelledBy)} ${formatDateTime(r.cancelledAt)} · เหตุผล: ${r.cancelReason ?? "-"}`
        : `สร้างโดย ${fullName(r.createdBy)} ${formatDateTime(r.createdAt)}`;

  return (
    <>
      <PageHeader
        title={`ใบนำเข้า ${r.docNo}`}
        backHref="/inventory/receipts"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "นำเข้า", href: "/inventory/receipts" }, { label: r.docNo }]}
        actions={
          <>
            <DocStatusBadge kind="receipt" status={r.status} />
            <span className="hidden text-xs text-muted-foreground sm:inline">{info}</span>
            <AuditHistory entityType="GoodsReceipt" entityId={r.id} />
          </>
        }
      />
      <ReceiptForm
        key={`${r.updatedAt.toISOString()}-${serialCount}`}
        receipt={view}
        options={options}
        canEdit={can(user.permissions, "inventory.receipt", "edit")}
        canCancel={can(user.permissions, "inventory.receipt", "cancel")}
        orderOptions={orderOptions}
        orderRemaining={r.status === "DRAFT" && open ? Object.fromEntries(open.lines.map((l) => [l.orderLineId, l.remaining])) : {}}
      />
    </>
  );
}
