import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { todayBangkok } from "@/lib/stock-rules";
import { issuableReturns, openReturnLines } from "@/server/purchase-returns";
import { PageHeader } from "@/components/page-header";
import { IssueForm, type IssueValues } from "../issue-form";

export const metadata = { title: "สร้างใบนำออก" };

/** ?rt=id → ประเภท "ส่งคืน" อ้างอิงใบส่งคืน (ผู้รับ = ผู้ขาย) */
export default async function NewIssuePage({ searchParams }: PageProps<"/inventory/issues/new">) {
  const user = await requirePagePermission("inventory.issue", "create");
  const sp = await searchParams;
  const rtId = typeof sp.rt === "string" ? sp.rt : null;
  const [returnOptions, rt] = await Promise.all([issuableReturns(), rtId ? openReturnLines(rtId) : Promise.resolve(null)]);
  const usable = rt && (rt.purchaseReturn.status === "APPROVED" || rt.purchaseReturn.status === "PARTIAL") ? rt : null;
  const defaults: IssueValues = usable
    ? {
        type: "RETURN",
        docDate: todayBangkok(),
        purchaseReturn: { id: usable.purchaseReturn.id, docNo: usable.purchaseReturn.docNo, lines: usable.lines },
        contact: usable.purchaseReturn.vendor,
        recipientName: usable.purchaseReturn.vendor.name,
        shippingAddress: "",
        note: "",
        lines: [],
      }
    : { type: "SALE", docDate: todayBangkok(), purchaseReturn: null, contact: null, recipientName: "", shippingAddress: "", note: "", lines: [] };
  return (
    <>
      <PageHeader
        title="สร้างใบนำออก"
        backHref="/inventory/issues"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "นำออก", href: "/inventory/issues" }, { label: "สร้างใบนำออก" }]}
      />
      {rtId && !usable && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">ใบส่งคืนนี้ยังไม่อนุมัติ หรือส่งคืนครบแล้ว</p>}
      <IssueForm
        issue={null}
        canEdit
        canPost={can(user.permissions, "inventory.issue", "edit")}
        canCancel={false}
        returnOptions={returnOptions}
        defaults={defaults}
      />
    </>
  );
}
