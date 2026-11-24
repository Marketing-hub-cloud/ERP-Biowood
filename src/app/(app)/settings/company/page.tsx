import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { fileUrl } from "@/lib/storage";
import { getCompany } from "@/server/company";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { CompanyForm } from "./company-form";

export const metadata = { title: "ข้อมูลบริษัท" };

export default async function CompanyPage() {
  const user = await requirePagePermission("settings.company", "view");
  const c = await getCompany();
  return (
    <>
      <PageHeader
        title="ข้อมูลบริษัท"
        breadcrumbs={[{ label: "ตั้งค่า" }, { label: "ข้อมูลบริษัท" }]}
        actions={<AuditHistory entityType="CompanySetting" entityId="1" />}
      />
      <CompanyForm
        canEdit={can(user.permissions, "settings.company", "edit")}
        logoUrl={fileUrl(c.logoKey)}
        initial={{
          nameTh: c.nameTh,
          nameEn: c.nameEn ?? "",
          address: c.address ?? "",
          taxId: c.taxId ?? "",
          branch: c.branch ?? "",
          phone: c.phone ?? "",
          email: c.email ?? "",
          website: c.website ?? "",
        }}
      />
    </>
  );
}
