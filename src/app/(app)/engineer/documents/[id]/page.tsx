import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDateTime, fullName } from "@/lib/format";
import { dateOnlyString } from "@/lib/stock-rules";
import { fileUrl } from "@/lib/storage";
import { canManageFile, canRunTransition, fileKindOpen, nextTransition, stepIndex } from "@/lib/engineer-workflow";
import { getEngineerDetail, getEngineerFormOptions } from "@/server/engineer-docs";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EngineerForm } from "../engineer-form";
import { EngineerStatusBadge, EngineerStepper, FilesPanel, StepTimeline, UrgentBadge, UserAvatar } from "../engineer-ui";

export default async function EngineerDocPage({ params }: PageProps<"/engineer/documents/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("engineer.document", "view");
  const [detail, options] = await Promise.all([getEngineerDetail(id), getEngineerFormOptions()]);
  if (!detail) notFound();
  const { doc: d, steps } = detail;

  const t = nextTransition(d.status);
  const advance = t && canRunTransition(t, user.permissions, user.id, d.assigneeId) ? { label: t.label, to: t.to, allowed: true, isApprove: t.perm === "approve" } : null;
  const reached = d.status === "CANCELLED" ? (steps.findLast((s) => s.toStatus === "CANCELLED")?.fromStatus ?? null) : null;
  const files = d.files.map((f) => ({ id: f.id, kind: f.kind, fileName: f.fileName, size: f.size, uploadedBy: fullName(f.uploadedBy), createdAt: f.createdAt.toISOString() }));
  const manage = (kind: "CUSTOMER_DRAWING" | "RETURN_DOC") => fileKindOpen(kind, d.status) && canManageFile(kind, user.permissions, user.id, d.assigneeId);
  const returnHint =
    stepIndex(d.status) < stepIndex("ASSIGNED") && d.status !== "CANCELLED" ? "แนบได้ตั้งแต่ขั้นมอบหมาย (ผลงานถอดแบบ ต้องแนบก่อนส่งตรวจรับงาน)" : undefined;

  return (
    <>
      <PageHeader
        title={`ใบถอดแบบ/ติดตั้ง ${d.docNo}`}
        backHref="/engineer/documents"
        breadcrumbs={[{ label: "ถอดแบบ/ติดตั้ง" }, { label: "ใบถอดแบบ/ติดตั้ง", href: "/engineer/documents" }, { label: d.docNo }]}
        actions={
          <>
            {d.urgency === "URGENT" && <UrgentBadge />}
            <EngineerStatusBadge status={d.status} />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              สร้างโดย {fullName(d.createdBy)} {formatDateTime(d.createdAt)}
            </span>
            <AuditHistory entityType="EngineerDoc" entityId={d.id} />
          </>
        }
      />
      <div className="mb-4">
        <EngineerStepper status={d.status} reached={reached} />
        {d.status === "CANCELLED" && (
          <p className="mt-2 text-sm text-destructive">
            ยกเลิกโดย {fullName(d.cancelledBy)} {formatDateTime(d.cancelledAt)} · เหตุผล: {d.cancelReason}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <EngineerForm
          key={d.updatedAt.toISOString()}
          doc={{ id: d.id, docNo: d.docNo, status: d.status, createdAt: d.createdAt.toISOString() }}
          options={options}
          canEdit={can(user.permissions, "engineer.document", "edit")}
          canCancel={can(user.permissions, "engineer.document", "cancel")}
          advance={advance}
          initial={{
            docDate: dateOnlyString(d.docDate),
            startDate: d.startDate ? dateOnlyString(d.startDate) : "",
            dueDate: d.dueDate ? dateOnlyString(d.dueDate) : "",
            revision: String(d.revision),
            workTypes: d.workTypes,
            workDetail: d.workDetail ?? "",
            projectName: d.projectName,
            project: d.project,
            urgency: d.urgency,
            customer: d.customer,
            addressLabel: d.addressLabel ?? "",
            siteAddress: d.siteAddress ?? "",
            assigneeId: d.assigneeId ?? "",
            participantIds: d.participants.map((p) => p.userId),
            note: d.note ?? "",
            estimateLines: d.estimateLines.map((l) => ({ key: l.id, productId: l.productId, quantity: l.quantity.toString(), note: l.note ?? "" })),
          }}
        />
        <div className="space-y-4">
          {d.assignee && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ผู้รับผิดชอบงาน</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2 text-sm">
                <UserAvatar user={{ name: fullName(d.assignee), avatarUrl: fileUrl(d.assignee.avatarKey) }} />
                {fullName(d.assignee)}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ไฟล์แนบ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FilesPanel docId={d.id} kind="CUSTOMER_DRAWING" files={files} canManage={manage("CUSTOMER_DRAWING")} />
              <FilesPanel docId={d.id} kind="RETURN_DOC" files={files} canManage={manage("RETURN_DOC")} hint={returnHint} />
            </CardContent>
          </Card>
          <StepTimeline
            steps={steps.map((s) => ({
              id: s.id,
              fromStatus: s.fromStatus,
              toStatus: s.toStatus,
              actorName: fullName(s.actor),
              comment: s.comment,
              createdAt: s.createdAt.toISOString(),
            }))}
          />
        </div>
      </div>
    </>
  );
}
