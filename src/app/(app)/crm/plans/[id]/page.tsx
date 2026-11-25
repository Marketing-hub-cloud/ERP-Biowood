import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDateTime, formatNumber, fullName } from "@/lib/format";
import { dateToBangkokLocal } from "@/lib/date-input";
import { canPlanAction, isPlanOpen, PLAN_ACTION_LABELS, type PlanAction } from "@/lib/crm";
import { mapsUrl } from "@/lib/distance";
import { getPlan, getPlanFormOptions } from "@/server/work-plans";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanStatusBadge } from "../../_components/crm-ui";
import { CheckinPanel } from "../checkin-panel";
import { PlanForm } from "../plan-form";

function Point({ label, lat, lng, at, accuracy }: { label: string; lat: unknown; lng: unknown; at: Date | null; accuracy: number | null }) {
  if (lat === null || lat === undefined) {
    return (
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm text-muted-foreground">ยังไม่เช็คอิน</div>
      </div>
    );
  }
  const p = { lat: Number(lat), lng: Number(lng) };
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{formatDateTime(at)}</div>
      <a href={mapsUrl(p)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        {p.lat.toFixed(6)}, {p.lng.toFixed(6)} <ExternalLink className="size-3" />
      </a>
      {accuracy !== null && <div className="text-xs text-muted-foreground">ความแม่นยำ ±{formatNumber(accuracy)} ม.</div>}
    </div>
  );
}

export default async function PlanPage({ params }: PageProps<"/crm/plans/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("crm.plan", "view");
  const [p, options] = await Promise.all([getPlan(id), getPlanFormOptions()]);
  if (!p) notFound();
  const open = isPlanOpen(p.status);
  const allowed = Object.fromEntries(
    (["checkin_start", "checkin_end", "complete", "cancel"] as PlanAction[]).map((a) => [
      a,
      canPlanAction(a, user.permissions, user.id, p.employeeId) &&
        (a === "checkin_start" ? p.status === "PLANNED" : a === "checkin_end" ? p.status === "CHECKED_IN" : open),
    ]),
  );
  const canEdit = open && (can(user.permissions, "crm.plan", "edit") || p.employeeId === user.id);
  const notOwner = open && p.employeeId !== user.id;

  return (
    <>
      <PageHeader
        title={p.subject}
        backHref="/crm/plans"
        breadcrumbs={[{ label: "การขาย (CRM)" }, { label: "แผนการทำงาน", href: "/crm/plans" }, { label: p.subject }]}
        actions={
          <>
            <PlanStatusBadge status={p.status} />
            <AuditHistory entityType="WorkPlan" entityId={p.id} />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">เช็คอิน</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm">
                <div className="font-medium">{fullName(p.employee)}</div>
                <div className="text-muted-foreground tabular-nums">
                  {formatDateTime(p.plannedStart)} – {formatDateTime(p.plannedEnd)}
                </div>
                {p.location && <div className="text-muted-foreground">{p.location}</div>}
                {p.customer && <div>ลูกค้า: {p.customer.name}</div>}
                {p.project && (
                  <div>
                    โครงการ:{" "}
                    <Link href={`/crm/projects/${p.project.id}`} className="text-primary hover:underline">
                      {p.project.name}
                    </Link>
                  </div>
                )}
              </div>
              <CheckinPanel planId={p.id} allowed={allowed} />
              {notOwner && <p className="text-xs text-muted-foreground">{PLAN_ACTION_LABELS.checkin_start}/จุดหมาย ได้เฉพาะพนักงานเจ้าของแผน</p>}
              <div className="grid grid-cols-2 gap-3 border-t pt-3">
                <Point label="จุดเริ่มต้น" lat={p.startLat} lng={p.startLng} at={p.startAt} accuracy={p.startAccuracy} />
                <Point label="จุดหมาย" lat={p.endLat} lng={p.endLng} at={p.endAt} accuracy={p.endAccuracy} />
              </div>
              <div className="rounded-md bg-muted/60 p-3 text-center">
                <div className="text-xs text-muted-foreground">ระยะทาง (เส้นตรง)</div>
                <div className="text-2xl font-semibold tabular-nums" data-testid="plan-distance">
                  {p.distanceKm === null ? "-" : `${formatNumber(p.distanceKm.toString(), 2)} กม.`}
                </div>
              </div>
              {p.status === "CANCELLED" && (
                <p className="text-sm text-destructive">
                  ยกเลิก {formatDateTime(p.cancelledAt)}
                  {p.cancelReason ? ` · ${p.cancelReason}` : ""}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        <PlanForm
          key={p.updatedAt.toISOString()}
          planId={p.id}
          options={options}
          canEdit={canEdit}
          canChangeEmployee={p.status === "PLANNED" && can(user.permissions, "crm.plan", "edit")}
          initial={{
            subject: p.subject,
            plannedStart: dateToBangkokLocal(p.plannedStart),
            plannedEnd: dateToBangkokLocal(p.plannedEnd),
            employeeId: p.employeeId,
            customer: p.customer,
            project: p.project,
            location: p.location ?? "",
            detail: p.detail ?? "",
          }}
        />
      </div>
    </>
  );
}
