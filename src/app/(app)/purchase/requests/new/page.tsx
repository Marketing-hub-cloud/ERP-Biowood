import { requirePagePermission } from "@/lib/session";
import { todayBangkok } from "@/lib/stock-rules";
import { getPurchaseFormOptions } from "@/server/purchase-common";
import { PageHeader } from "@/components/page-header";
import { RequestForm } from "../request-form";

export const metadata = { title: "สร้างใบขอซื้อ" };

export default async function NewRequestPage() {
  const user = await requirePagePermission("purchase.request", "create");
  const options = await getPurchaseFormOptions();
  const warehouses = options.warehouses.filter((w) => w.isActive);
  return (
    <>
      <PageHeader
        title="สร้างใบขอซื้อ"
        backHref="/purchase/requests"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบขอซื้อ", href: "/purchase/requests" }, { label: "สร้างใบขอซื้อ" }]}
      />
      <RequestForm
        doc={null}
        options={options}
        canEdit
        canApproveNow={false}
        canCancel={false}
        canCreateOrder={false}
        initial={{
          docDate: todayBangkok(),
          requiredDate: "",
          requesterId: user.id,
          department: user.department ?? "",
          position: user.position ?? "",
          reference: "",
          warehouseId: warehouses.length === 1 ? warehouses[0].id : "",
          note: "",
          lines: [{ key: "l1", productId: "", quantity: "", note: "" }],
        }}
      />
    </>
  );
}
