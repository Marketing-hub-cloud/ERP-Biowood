import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { canOnContact, canRole } from "@/lib/contact-rules";
import { formatDateTime } from "@/lib/format";
import { canManageContactOptions, contactInclude, getContactFormOptions } from "@/server/contacts";
import { PageHeader } from "@/components/page-header";
import { AuditHistory } from "@/components/audit-history";
import { ContactForm } from "../contact-form";
import { toFormValues } from "../form-values";
import { RoleBadges } from "../contacts-table";

export default async function ContactDetailPage({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const c = await prisma.contact.findFirst({ where: { id, deletedAt: null }, include: contactInclude });
  if (!c) notFound();
  if (!canOnContact(user.permissions, c, "view")) redirect("/forbidden");

  const options = await getContactFormOptions();
  const canEdit = canOnContact(user.permissions, c, "edit");
  const backHref = c.isCustomer && canRole(user.permissions, "customer", "view") ? "/contacts/customers" : "/contacts/vendors";

  return (
    <>
      <PageHeader
        title={c.name}
        backHref={backHref}
        breadcrumbs={[{ label: "ผู้ติดต่อ" }, { label: backHref.endsWith("customers") ? "ลูกค้า" : "ผู้ขาย", href: backHref }, { label: c.code }]}
        actions={
          <>
            <RoleBadges isCustomer={c.isCustomer} isVendor={c.isVendor} />
            <span className="hidden text-xs text-muted-foreground sm:inline">แก้ไขล่าสุด {formatDateTime(c.updatedAt)}</span>
            <AuditHistory entityType="Contact" entityId={c.id} />
          </>
        }
      />
      <ContactForm
        key={c.updatedAt.toISOString()}
        mode="edit"
        contactId={c.id}
        initial={toFormValues(c)}
        options={options}
        canEdit={canEdit}
        canDelete={canOnContact(user.permissions, c, "delete")}
        roleEditable={{ customer: canEdit && canRole(user.permissions, "customer", "edit"), vendor: canEdit && canRole(user.permissions, "vendor", "edit") }}
        canAddOptions={canManageContactOptions(user)}
        backHref={backHref}
        photoUrl={fileUrl(c.photoKey)}
      />
    </>
  );
}
