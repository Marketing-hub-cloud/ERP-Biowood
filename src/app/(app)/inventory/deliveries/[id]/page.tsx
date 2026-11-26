import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDateTime, fullName } from "@/lib/format";
import { dateToBangkokLocal } from "@/lib/date-input";
import { canDeliveryAction, mapHref } from "@/lib/delivery";
import { ISSUE_STATUS_LABELS, ISSUE_TYPE_LABELS } from "@/lib/stock-rules";
import { getDelivery, getDeliveryFormOptions } from "@/server/deliveries";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeliveryStatusBadge } from "../delivery-ui";
import { DeliveryActions } from "../delivery-actions";
import { DeliveryForm } from "../delivery-form";

export default async function DeliveryPage({ params }: PageProps<"/inventory/deliveries/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("inventory.delivery", "view");
  const j = await getDelivery(id);
  if (!j) notFound();
  const options = await getDeliveryFormOptions(j.goodsIssueId);
  const open = j.status === "SCHEDULED";
  const href = mapHref(j.mapUrl);
  const gi = j.goodsIssue;

  return (
    <>
      <PageHeader
        title={`งานจัดส่ง ${gi.docNo}`}
        backHref="/inventory/deliveries"
        breadcrumbs={[{ label: "คลังสินค้า" }, { label: "ตารางงานพนักงานส่ง", href: "/inventory/deliveries" }, { label: `${gi.docNo} · ${formatDateTime(j.startAt)}` }]}
        actions={
          <>
            <DeliveryStatusBadge status={j.status} />
            <AuditHistory entityType="DeliveryJob" entityId={j.id} />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">สรุปงาน</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="font-medium">{fullName(j.driver)}</div>
              <div className="text-muted-foreground tabular-nums">
                {formatDateTime(j.startAt)} – {formatDateTime(j.endAt)}
              </div>
            </div>
            <div>
              ใบนำออก:{" "}
              <Link href={`/inventory/issues/${gi.id}`} className="text-primary hover:underline">
                {gi.docNo}
              </Link>{" "}
              <span className="text-muted-foreground">
                ({ISSUE_TYPE_LABELS[gi.type]} · {ISSUE_STATUS_LABELS[gi.status]})
              </span>
            </div>
            {(gi.contact || gi.recipientName) && <div>ผู้รับ: {gi.recipientName || gi.contact?.name}</div>}
            {j.shippingAddress && <div className="whitespace-pre-line text-muted-foreground">{j.shippingAddress}</div>}
            {href && (
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                เปิด Google Map <ExternalLink className="size-3" />
              </a>
            )}
            {j.status === "DELIVERED" && <p className="text-emerald-700">ส่งแล้ว {formatDateTime(j.deliveredAt)}</p>}
            {j.status === "CANCELLED" && (
              <p className="text-destructive">
                ยกเลิก {formatDateTime(j.cancelledAt)}
                {j.cancelReason ? ` · ${j.cancelReason}` : ""}
              </p>
            )}
            {open && (
              <div className="border-t pt-3">
                <DeliveryActions
                  jobId={j.id}
                  allowed={{
                    deliver: canDeliveryAction("deliver", user.permissions, user.id, j.driverId),
                    cancel: canDeliveryAction("cancel", user.permissions, user.id, j.driverId),
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
        <DeliveryForm
          key={j.updatedAt.toISOString()}
          jobId={j.id}
          options={options}
          canEdit={open && can(user.permissions, "inventory.delivery", "edit")}
          initial={{
            goodsIssueId: j.goodsIssueId,
            startAt: dateToBangkokLocal(j.startAt),
            endAt: dateToBangkokLocal(j.endAt),
            driverId: j.driverId,
            mapUrl: j.mapUrl ?? "",
            shippingAddress: j.shippingAddress ?? "",
            note: j.note ?? "",
          }}
        />
      </div>
    </>
  );
}
