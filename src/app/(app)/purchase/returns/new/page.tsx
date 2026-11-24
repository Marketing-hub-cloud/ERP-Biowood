import { requirePagePermission } from "@/lib/session";
import { prisma } from "@/lib/db";
import { todayBangkok } from "@/lib/stock-rules";
import { returnableLines } from "@/server/purchase-orders";
import { PageHeader } from "@/components/page-header";
import { ReturnForm } from "../return-form";
import { linesFromOrder } from "../return-values";

export const metadata = { title: "สร้างใบส่งคืน" };

/** ?po=id → ดึงรายการที่คืนได้ของใบสั่งซื้อมาให้ */
export default async function NewReturnPage({ searchParams }: PageProps<"/purchase/returns/new">) {
  await requirePagePermission("purchase.return", "create");
  const sp = await searchParams;
  const poId = typeof sp.po === "string" ? sp.po : null;
  const [reasons, orders, order] = await Promise.all([
    prisma.lookupOption.findMany({ where: { kind: "RETURN_REASON" }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["PARTIAL", "COMPLETED"] } },
      include: { vendor: { select: { name: true } } },
      orderBy: { docNo: "desc" },
      take: 200,
    }),
    poId ? returnableLines(poId) : Promise.resolve(null),
  ]);
  const usable = order && ["PARTIAL", "COMPLETED"].includes(order.order.status) ? order : null;
  return (
    <>
      <PageHeader
        title="สร้างใบส่งคืน"
        backHref="/purchase/returns"
        breadcrumbs={[{ label: "จัดซื้อ" }, { label: "ใบส่งคืน", href: "/purchase/returns" }, { label: "สร้างใบส่งคืน" }]}
      />
      {poId && !usable && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">ใบสั่งซื้อนี้ยังไม่มีการนำเข้า จึงยังส่งคืนไม่ได้</p>}
      <ReturnForm
        doc={null}
        reasons={reasons.map((r) => ({ id: r.id, label: r.label, isActive: r.isActive }))}
        orderOptions={orders.map((o) => ({ id: o.id, docNo: o.docNo, vendor: o.vendor.name }))}
        canEdit
        canApproveNow={false}
        canCancel={false}
        canIssue={false}
        initial={{
          docDate: todayBangkok(),
          orderId: usable?.order.id ?? "",
          orderDocNo: usable?.order.docNo ?? "",
          vendorName: usable?.order.vendor.name ?? "",
          reasonId: null,
          note: "",
          lines: usable ? linesFromOrder(usable) : [],
        }}
      />
    </>
  );
}
