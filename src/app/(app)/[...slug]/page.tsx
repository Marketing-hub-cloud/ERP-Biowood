import { notFound } from "next/navigation";
import { Construction } from "lucide-react";
import { findMenuByPath } from "@/lib/menu";
import { requirePagePermission } from "@/lib/session";
import { PageHeader } from "@/components/page-header";

// หน้า placeholder สำหรับเมนูที่ยังไม่ถึงเฟสพัฒนา (บังคับสิทธิ์ view เหมือนหน้าจริง)
export default async function PlaceholderPage({ params }: PageProps<"/[...slug]">) {
  const { slug } = await params;
  const found = findMenuByPath("/" + slug.join("/"));
  if (!found || found.item.ready) notFound();
  await requirePagePermission(found.item.key, "view");
  return (
    <>
      <PageHeader title={found.item.label} breadcrumbs={[{ label: found.section.label }, { label: found.item.label }]} />
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-card py-20 text-center">
        <Construction className="size-10 text-muted-foreground" />
        <p className="font-medium">กำลังพัฒนา</p>
        <p className="text-sm text-muted-foreground">เมนูนี้จะเปิดใช้งานในเฟสถัดไป</p>
      </div>
    </>
  );
}
