import { requirePagePermission } from "@/lib/session";
import { getStockFormOptions } from "@/server/goods-receipts";
import { todayBangkok } from "@/lib/stock-rules";
import { PageHeader } from "@/components/page-header";
import { ReceiptForm } from "../receipt-form";

export const metadata = { title: "สร้างใบนำเข้า" };

export default async function NewReceiptPage() {
  await requirePagePermission("inventory.receipt", "create");
  const options = await getStockFormOptions();
  const warehouses = options.locations.filter((n) => n.level === 0 && n.isActive);
  return (
    <>
      <PageHeader
        title="สร้างใบนำเข้า"
        backHref="/inventory/receipts"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "นำเข้า", href: "/inventory/receipts" }, { label: "สร้างใบนำเข้า" }]}
      />
      <ReceiptForm
        receipt={null}
        options={options}
        canEdit
        canCancel={false}
        defaults={{
          type: "OTHER",
          docDate: todayBangkok(),
          warehouseId: warehouses.length === 1 ? warehouses[0].id : "",
          lot: "",
          note: "",
          lines: [{ key: "l1", id: null, productId: "", locationId: null, note: "" }],
        }}
      />
    </>
  );
}
