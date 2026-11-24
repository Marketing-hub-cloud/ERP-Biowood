import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/session";
import { rolesWith, type ContactRole } from "@/lib/contact-rules";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContactsTable } from "./contacts-table";

export type ContactTab = "all" | ContactRole;

const TABS: { tab: ContactTab; label: string; href: string }[] = [
  { tab: "all", label: "ทั้งหมด", href: "/contacts/all" },
  { tab: "customer", label: "ลูกค้า", href: "/contacts/customers" },
  { tab: "vendor", label: "ผู้ขาย", href: "/contacts/vendors" },
];

/** หน้ารายการผู้ติดต่อ (ใช้ร่วม 3 แท็บ) */
export async function ContactsListPage({ tab }: { tab: ContactTab }) {
  const user = await requireUser();
  const viewable = rolesWith(user.permissions, "view");
  const allowed = tab === "all" ? viewable.length > 0 : viewable.includes(tab);
  if (!allowed) redirect("/forbidden");

  const creatable = rolesWith(user.permissions, "create");
  const [lookups, tags, provinces] = await Promise.all([
    prisma.lookupOption.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
    prisma.contact.findMany({
      where: { deletedAt: null, regProvince: { not: null } },
      select: { regProvince: true },
      distinct: ["regProvince"],
      orderBy: { regProvince: "asc" },
    }),
  ]);
  const current = TABS.find((t) => t.tab === tab)!;
  const newRole = tab !== "all" && creatable.includes(tab) ? tab : creatable[0];

  return (
    <>
      <PageHeader
        title="ผู้ติดต่อ"
        breadcrumbs={[{ label: "ผู้ติดต่อ" }, { label: current.label }]}
        actions={
          newRole && (
            <Button asChild>
              <Link href={`/contacts/new?role=${newRole}`}>
                <Plus /> สร้างผู้ติดต่อ
              </Link>
            </Button>
          )
        }
      />
      <nav className="mb-3 flex gap-1 border-b" aria-label="ประเภทผู้ติดต่อ">
        {TABS.filter((t) => (t.tab === "all" ? viewable.length > 0 : viewable.includes(t.tab))).map((t) => (
          <Link
            key={t.tab}
            href={t.href}
            aria-current={t.tab === tab ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              t.tab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <ContactsTable
        key={tab}
        tab={tab}
        sources={lookups.filter((l) => l.kind === "CONTACT_SOURCE").map((l) => ({ value: l.id, label: l.label }))}
        businessTypes={lookups.filter((l) => l.kind === "CUSTOMER_BUSINESS_TYPE").map((l) => ({ value: l.id, label: l.label }))}
        tags={tags.map((t) => ({ value: t.id, label: t.name }))}
        provinces={provinces.map((p) => p.regProvince!).map((p) => ({ value: p, label: p }))}
      />
    </>
  );
}
