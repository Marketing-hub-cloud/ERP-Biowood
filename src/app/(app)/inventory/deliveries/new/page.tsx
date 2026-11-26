import { requirePagePermission } from "@/lib/session";
import { todayBangkok } from "@/lib/stock-rules";
import { getDeliveryFormOptions } from "@/server/deliveries";
import { PageHeader } from "@/components/page-header";
import { DeliveryForm } from "../delivery-form";

export const metadata = { title: "สร้างงานจัดส่ง" };

/** ?issue=<id> = สร้างจากหน้าใบนำออก (ล็อกใบนำออก + ดึงที่อยู่จัดส่งมาให้) */
export default async function NewDeliveryPage({ searchParams }: PageProps<"/inventory/deliveries/new">) {
  const user = await requirePagePermission("inventory.delivery", "create");
  const sp = await searchParams;
  const issueId = typeof sp.issue === "string" ? sp.issue : null;
  const options = await getDeliveryFormOptions(issueId);
  const issue = issueId ? options.issues.find((i) => i.id === issueId) : undefined;
  const today = todayBangkok();
  return (
    <>
      <PageHeader
        title="สร้างงานจัดส่ง"
        backHref={issue ? `/inventory/issues/${issue.id}` : "/inventory/deliveries"}
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "ตารางงานพนักงานส่ง", href: "/inventory/deliveries" }, { label: "สร้างงานจัดส่ง" }]}
      />
      <div className="mx-auto max-w-3xl">
        <DeliveryForm
          jobId={null}
          options={options}
          canEdit
          issueLocked={!!issue}
          initial={{
            goodsIssueId: issue?.id ?? "",
            startAt: `${today}T09:00`,
            endAt: `${today}T12:00`,
            driverId: user.id,
            mapUrl: "",
            shippingAddress: issue?.shippingAddress ?? "",
            note: "",
          }}
        />
      </div>
    </>
  );
}
