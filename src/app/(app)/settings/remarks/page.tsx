import { requirePagePermission } from "@/lib/session";
import { can } from "@/lib/rbac";
import { listNoteTemplates } from "@/server/note-templates";
import { PageHeader } from "@/components/page-header";
import { RemarksEditor } from "./remarks-editor";

export const metadata = { title: "ตั้งค่าหมายเหตุ" };

export default async function RemarksPage() {
  const user = await requirePagePermission("settings.remark", "view");
  const rows = await listNoteTemplates();
  return (
    <>
      <PageHeader title="ตั้งค่าหมายเหตุ" breadcrumbs={[{ label: "ตั้งค่า" }, { label: "ตั้งค่าหมายเหตุ" }]} />
      <p className="mb-4 text-sm text-muted-foreground">หมายเหตุสำเร็จรูปแยกตามโมดูล ในเอกสารเลือกมาใส่ได้แล้วแก้ข้อความต่อได้</p>
      <div className="space-y-4">
        <RemarksEditor
          rows={rows.map((r) => ({ id: r.id, module: r.module, title: r.title, body: r.body, sortOrder: r.sortOrder, isActive: r.isActive }))}
          canCreate={can(user.permissions, "settings.remark", "create")}
          canEdit={can(user.permissions, "settings.remark", "edit")}
          canDelete={can(user.permissions, "settings.remark", "delete")}
        />
      </div>
    </>
  );
}
