import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, FileText } from "lucide-react";
import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { dateOnlyString } from "@/lib/stock-rules";
import { getProject, getProjectFormOptions } from "@/server/projects";
import { PageHeader } from "@/components/page-header";
import { AuditHistory, AuditList } from "@/components/audit-history";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EngineerStatusBadge } from "@/app/(app)/engineer/documents/engineer-ui";
import { PlanStatusBadge, ProjectStatusBadge, ProjectStepper } from "../../_components/crm-ui";
import { ProjectForm } from "../project-form";

export default async function ProjectPage({ params }: PageProps<"/crm/projects/[id]">) {
  const { id } = await params;
  const user = await requirePagePermission("crm.project", "view");
  const [detail, options] = await Promise.all([getProject(id), getProjectFormOptions()]);
  if (!detail) notFound();
  const { project: p, engineerDocs, plans } = detail;
  const canEngineer = can(user.permissions, "engineer.document", "create");

  return (
    <>
      <PageHeader
        title={p.name}
        backHref="/crm/projects"
        breadcrumbs={[{ label: "การขาย (CRM)" }, { label: "โครงการ", href: "/crm/projects" }, { label: p.name }]}
        actions={
          <>
            <ProjectStatusBadge status={p.status} />
            {canEngineer && (
              <Button asChild variant="outline">
                <Link href={`/engineer/documents/new?project=${p.id}`}>
                  <FilePlus2 /> สร้างใบถอดแบบ
                </Link>
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                {/* ใบเสนอราคา: ยังไม่มีสเปก (CLAUDE.md หัวข้อ 10) */}
                <span tabIndex={0}>
                  <Button variant="outline" disabled>
                    <FileText /> สร้างใบเสนอราคา
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>ยังไม่เปิดใช้ — รอสเปกใบเสนอราคา</TooltipContent>
            </Tooltip>
            <AuditHistory entityType="Project" entityId={p.id} title="การเคลื่อนไหว" />
          </>
        }
      />
      <div className="mb-4">
        <ProjectStepper status={p.status} />
        <p className="mt-2 text-xs text-muted-foreground">
          สร้างโดย {fullName(p.createdBy)} {formatDateTime(p.createdAt)} · เปลี่ยนสถานะได้ที่ช่อง &quot;สถานะ&quot; แล้วกดบันทึก
        </p>
      </div>
      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">ข้อมูลโครงการ</TabsTrigger>
          <TabsTrigger value="activity">การเคลื่อนไหว</TabsTrigger>
        </TabsList>
        <TabsContent value="info" className="mt-4">
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
            <ProjectForm
              key={p.updatedAt.toISOString()}
              projectId={p.id}
              options={options}
              canEdit={can(user.permissions, "crm.project", "edit")}
              canDelete={can(user.permissions, "crm.project", "delete")}
              initial={{
                name: p.name,
                status: p.status,
                customer: p.customer,
                contactPerson: p.contactPerson ?? "",
                salesRepId: p.salesRepId ?? "",
                businessTypeId: p.businessTypeId,
                workStageId: p.workStageId,
                workNatureId: p.workNatureId,
                workDetail: p.workDetail ?? "",
                probability: p.probability === null ? "" : String(p.probability),
                expectedCloseDate: p.expectedCloseDate ? dateOnlyString(p.expectedCloseDate) : "",
                value: p.value === null ? "" : p.value.toString(),
                tagIds: p.tags.map((t) => t.tagId),
                warrantyStart: p.warrantyStart ? dateOnlyString(p.warrantyStart) : "",
                warrantyEnd: p.warrantyEnd ? dateOnlyString(p.warrantyEnd) : "",
                warrantyNote: p.warrantyNote ?? "",
                note: p.note ?? "",
              }}
            />
            <div className="space-y-4">
              {can(user.permissions, "engineer.document", "view") && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">ใบถอดแบบ/ติดตั้ง</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {engineerDocs.length === 0 ? (
                      <p className="text-sm text-muted-foreground">ยังไม่มี</p>
                    ) : (
                      <ul className="space-y-1 text-sm" data-testid="project-engineer-docs">
                        {engineerDocs.map((d) => (
                          <li key={d.id} className="flex items-center justify-between gap-2">
                            <Link href={`/engineer/documents/${d.id}`} className="font-mono text-primary hover:underline">
                              {d.docNo}
                            </Link>
                            <EngineerStatusBadge status={d.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}
              {can(user.permissions, "crm.plan", "view") && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base">แผนการทำงาน</CardTitle>
                    {can(user.permissions, "crm.plan", "create") && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/crm/plans/new?project=${p.id}`}>เพิ่มแผน</Link>
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    {plans.length === 0 ? (
                      <p className="text-sm text-muted-foreground">ยังไม่มี</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {plans.map((x) => (
                          <li key={x.id} className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <Link href={`/crm/plans/${x.id}`} className="block truncate text-primary hover:underline">
                                {x.subject}
                              </Link>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(x.plannedStart)} · {fullName(x.employee)}
                              </span>
                            </span>
                            <PlanStatusBadge status={x.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <AuditList entityType="Project" entityId={p.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
