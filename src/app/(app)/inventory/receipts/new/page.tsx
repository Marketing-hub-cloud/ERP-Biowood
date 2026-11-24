import { requirePagePermission } from "@/lib/session";
import { getStockFormOptions } from "@/server/goods-receipts";
import { openOrderLines, receivableOrders } from "@/server/purchase-orders";
import { todayBangkok, toMilli } from "@/lib/stock-rules";
import { PageHeader } from "@/components/page-header";
import { ReceiptForm, type ReceiptValues } from "../receipt-form";

export const metadata = { title: "สร้างใบนำเข้า" };

/** ?po=id → ประเภท "สั่งซื้อ" พร้อมรายการคงค้างของใบสั่งซื้อ */
export default async function NewReceiptPage({ searchParams }: PageProps<"/inventory/receipts/new">) {
  await requirePagePermission("inventory.receipt", "create");
  const sp = await searchParams;
  const poId = typeof sp.po === "string" ? sp.po : null;
  const [options, orderOptions, open] = await Promise.all([getStockFormOptions(), receivableOrders(), poId ? openOrderLines(poId) : Promise.resolve(null)]);
  const warehouses = options.locations.filter((n) => n.level === 0 && n.isActive);
  const usable = open && (open.order.status === "APPROVED" || open.order.status === "PARTIAL") ? open : null;
  const poLines = usable?.lines.filter((l) => l.isStockable && toMilli(l.remaining) > 0) ?? [];

  const defaults: ReceiptValues = usable
    ? {
        type: "PURCHASE",
        purchaseOrderId: usable.order.id,
        orderDocNo: usable.order.docNo,
        docDate: todayBangkok(),
        warehouseId: usable.order.warehouseId ?? (warehouses.length === 1 ? warehouses[0].id : ""),
        lot: "",
        note: "",
        lines: poLines.map((l, i) => ({ key: `l${i}`, id: null, productId: l.productId, locationId: null, orderLineId: l.orderLineId, note: "" })),
      }
    : {
        type: "OTHER",
        purchaseOrderId: null,
        orderDocNo: null,
        docDate: todayBangkok(),
        warehouseId: warehouses.length === 1 ? warehouses[0].id : "",
        lot: "",
        note: "",
        lines: [{ key: "l1", id: null, productId: "", locationId: null, orderLineId: null, note: "" }],
      };

  return (
    <>
      <PageHeader
        title="สร้างใบนำเข้า"
        backHref="/inventory/receipts"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "นำเข้า", href: "/inventory/receipts" }, { label: "สร้างใบนำเข้า" }]}
      />
      {poId && !usable && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">ใบสั่งซื้อนี้ยังไม่อนุมัติ หรือนำเข้าครบแล้ว</p>}
      <ReceiptForm
        receipt={null}
        options={options}
        canEdit
        canCancel={false}
        orderOptions={orderOptions}
        orderRemaining={usable ? Object.fromEntries(usable.lines.map((l) => [l.orderLineId, l.remaining])) : {}}
        defaults={defaults}
      />
    </>
  );
}
