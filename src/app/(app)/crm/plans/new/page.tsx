import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { todayBangkok } from "@/lib/stock-rules";
import { getPlanFormOptions } from "@/server/work-plans";
import { PageHeader } from "@/components/page-header";
import { PlanForm } from "../plan-form";

export const metadata = { title: "สร้างแผนการทำงาน" };

const contactSel = { id: true, code: true, name: true, isCustomer: true, isVendor: true } as const;

/** ?project=<id> หรือ ?customer=<id> เลือกให้ล่วงหน้า */
export default async function NewPlanPage({ searchParams }: PageProps<"/crm/plans/new">) {
  const user = await requirePagePermission("crm.plan", "create");
  const sp = await searchParams;
  const projectId = typeof sp.project === "string" ? sp.project : null;
  const customerId = typeof sp.customer === "string" ? sp.customer : null;
  const [options, project, customer] = await Promise.all([
    getPlanFormOptions(),
    projectId ? prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, name: true, customer: { select: contactSel } } }) : null,
    customerId ? prisma.contact.findFirst({ where: { id: customerId, deletedAt: null }, select: contactSel }) : null,
  ]);
  const today = todayBangkok();
  return (
    <>
      <PageHeader title="สร้างแผนการทำงาน" backHref="/crm/plans" breadcrumbs={[{ label: "การขาย (CRM)" }, { label: "แผนการทำงาน", href: "/crm/plans" }, { label: "สร้างแผน" }]} />
      <div className="mx-auto max-w-3xl">
        <PlanForm
          planId={null}
          options={options}
          canEdit
          canChangeEmployee={can(user.permissions, "crm.plan", "create")}
          initial={{
            subject: project ? `เยี่ยมลูกค้า ${project.name}` : "",
            plannedStart: `${today}T09:00`,
            plannedEnd: `${today}T10:00`,
            employeeId: user.id,
            customer: project?.customer ?? customer,
            project,
            location: "",
            detail: "",
          }}
        />
      </div>
    </>
  );
}
