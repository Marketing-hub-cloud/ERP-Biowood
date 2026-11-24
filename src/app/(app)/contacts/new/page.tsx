import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { rolesWith } from "@/lib/contact-rules";
import { canManageContactOptions, getContactFormOptions } from "@/server/contacts";
import { PageHeader } from "@/components/page-header";
import { ContactForm } from "../contact-form";
import { EMPTY_CONTACT_VALUES } from "../form-values";

export const metadata = { title: "สร้างผู้ติดต่อ" };

export default async function NewContactPage({ searchParams }: PageProps<"/contacts/new">) {
  const user = await requireUser();
  const creatable = rolesWith(user.permissions, "create");
  if (creatable.length === 0) redirect("/forbidden");
  const { role } = await searchParams;
  const preset = role === "customer" || role === "vendor" ? role : null;
  const initialRole = preset && creatable.includes(preset) ? preset : creatable[0];
  const backHref = initialRole === "vendor" ? "/contacts/vendors" : "/contacts/customers";
  const options = await getContactFormOptions();

  return (
    <>
      <PageHeader
        title="สร้างผู้ติดต่อ"
        backHref={backHref}
        breadcrumbs={[{ label: "ผู้ติดต่อ" }, { label: initialRole === "vendor" ? "ผู้ขาย" : "ลูกค้า", href: backHref }, { label: "สร้างผู้ติดต่อ" }]}
      />
      <ContactForm
        mode="create"
        initial={{ ...EMPTY_CONTACT_VALUES, isCustomer: initialRole === "customer", isVendor: initialRole === "vendor" }}
        options={options}
        canEdit
        roleEditable={{ customer: creatable.includes("customer"), vendor: creatable.includes("vendor") }}
        canAddOptions={canManageContactOptions(user)}
        backHref={backHref}
      />
    </>
  );
}
