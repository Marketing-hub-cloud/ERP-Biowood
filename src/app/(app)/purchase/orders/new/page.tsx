import { requirePagePermission } from "@/lib/session";
import { todayBangkok } from "@/lib/stock-rules";
import { getPurchaseFormOptions } from "@/server/purchase-common";
import { openRequestLines } from "@/server/purchase-requests";
import { PageHeader } from "@/components/page-header";
import { OrderForm } from "../order-form";
import { linesFromRequests } from "../order-values";

export const metadata = { title: "สร้างใบสั่งซื้อ" };

/** ?pr=id1,id2 → ดึงรายการคงค้างของใบขอซื้อมาให้ */
export default async function NewOrderPage({ searchParams }: PageProps<"/purchase/orders/new">) {
  await requirePagePermission("purchase.order", "create");
  const sp = await searchParams;
  const prIds = typeof sp.pr === "string" ? sp.pr.split(",").filter(Boolean).slice(0, 50) : [];
  const [options, openLines] = await Promise.all([getPurchaseFormOptions(), prIds.length ? openRequestLines(prIds) : Promise.resolve([])]);
  const lines = linesFromRequests(openLines);
  return (
    <>
      <PageHeader
        title="สร้างใบสั่งซื้อ"
        backHref="/purchase/orders"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบสั่งซื้อ", href: "/purchase/orders" }, { label: "สร้างใบสั่งซื้อ" }]}
      />
      {prIds.length > 0 && !openLines.length && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">ใบขอซื้อที่เลือกไม่มีรายการคงค้าง (สั่งซื้อครบแล้ว หรือยังไม่อนุมัติ)</p>
      )}
      <OrderForm
        doc={null}
        options={options}
        canEdit
        canApproveNow={false}
        canCancel={false}
        canReceive={false}
        canReturn={false}
        initial={{
          docDate: todayBangkok(),
          deliveryDate: "",
          vendor: null,
          paymentTerms: "",
          reference: "",
          warehouseId: openLines[0]?.warehouseId ?? "",
          note: "",
          vatMode: "EXCLUSIVE",
          headerDiscount: "",
          lines: lines.length ? lines : [{ key: "l1", productId: "", requestLineId: null, requestDocNo: null, quantity: "", unitPrice: "", discount: "", note: "" }],
        }}
      />
    </>
  );
}
