import { requirePagePermission } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getProjectFormOptions } from "@/server/projects";
import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "../project-form";

export const metadata = { title: "สร้างโครงการ" };

/** ?customer=<contactId> เลือกลูกค้าให้ (เช่น มาจากหน้าผู้ติดต่อ) */
export default async function NewProjectPage({ searchParams }: PageProps<"/crm/projects/new">) {
  const user = await requirePagePermission("crm.project", "create");
  const sp = await searchParams;
  const customerId = typeof sp.customer === "string" ? sp.customer : null;
  const [options, customer] = await Promise.all([
    getProjectFormOptions(),
    customerId
      ? prisma.contact.findFirst({ where: { id: customerId, deletedAt: null, isCustomer: true }, select: { id: true, code: true, name: true, isCustomer: true, isVendor: true } })
      : null,
  ]);
  return (
    <>
      <PageHeader title="สร้างโครงการ" backHref="/crm/projects" breadcrumbs={[{ label: "การขาย (CRM)" }, { label: "โครงการ", href: "/crm/projects" }, { label: "สร้างโครงการ" }]} />
      <ProjectForm
        projectId={null}
        options={options}
        canEdit
        canDelete={false}
        initial={{
          name: "",
          status: "NEW",
          customer,
          contactPerson: "",
          salesRepId: user.id,
          businessTypeId: null,
          workStageId: null,
          workNatureId: null,
          workDetail: "",
          probability: "",
          expectedCloseDate: "",
          value: "",
          tagIds: [],
          warrantyStart: "",
          warrantyEnd: "",
          warrantyNote: "",
          note: "",
        }}
      />
    </>
  );
}
