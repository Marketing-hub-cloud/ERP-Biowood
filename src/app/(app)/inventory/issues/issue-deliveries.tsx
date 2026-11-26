import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import { formatDateTime, fullName } from "@/lib/format";
import { deliveriesOfIssue } from "@/server/deliveries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeliveryStatusBadge } from "../deliveries/delivery-ui";

/** งานจัดส่งของใบนำออก (แสดงเมื่อมีสิทธิ์ดูตารางงานพนักงานส่ง) */
export async function IssueDeliveries({ issueId, canCreate }: { issueId: string; canCreate: boolean }) {
  const jobs = await deliveriesOfIssue(issueId);
  return (
    <Card className="mt-4" data-testid="issue-deliveries">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="size-4" /> งานจัดส่ง
        </CardTitle>
        {canCreate && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/inventory/deliveries/new?issue=${issueId}`}>
              <Plus /> สร้างงานจัดส่ง
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {jobs.length ? (
          <ul className="divide-y text-sm">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/inventory/deliveries/${j.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-muted/50">
                  <span className="tabular-nums">
                    {formatDateTime(j.startAt)} – {formatDateTime(j.endAt)}
                  </span>
                  <span>{fullName(j.driver)}</span>
                  <DeliveryStatusBadge status={j.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีงานจัดส่ง</p>
        )}
      </CardContent>
    </Card>
  );
}
