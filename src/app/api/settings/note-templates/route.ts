import { ApiError, apiHandler, readJson } from "@/lib/api";
import { can } from "@/lib/rbac";
import { noteTemplateSchema } from "@/lib/validators";
import { listNoteTemplates, saveNoteTemplate } from "@/server/note-templates";

/**
 * ?module=purchase&active=1 → หมายเหตุที่เปิดใช้งาน (ผู้ใช้ทุกคนที่ล็อกอินใช้เลือกใส่เอกสารได้)
 * ไม่ระบุ active → ทั้งหมด (ต้องมีสิทธิ์ดูหน้าตั้งค่าหมายเหตุ)
 */
export const GET = apiHandler({}, async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const active = sp.get("active") === "1";
  if (!active && !can(user.permissions, "settings.remark", "view")) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const rows = await listNoteTemplates(sp.get("module") ?? undefined, active);
  return rows.map((r) => ({ id: r.id, module: r.module, title: r.title, body: r.body, sortOrder: r.sortOrder, isActive: r.isActive }));
});

export const POST = apiHandler({ perm: ["settings.remark", "create"] }, async ({ req, user, ip }) => {
  const t = await saveNoteTemplate(user, null, noteTemplateSchema.parse(await readJson(req)), ip);
  return { id: t.id };
});
