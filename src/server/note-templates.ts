import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/errors";
import { NOTE_MODULES, type noteTemplateSchema } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";

export const ENTITY_NOTE_TEMPLATE = "NoteTemplate";
type Data = z.output<typeof noteTemplateSchema>;

const snap = (t: Data) => ({ module: NOTE_MODULES[t.module], title: t.title, body: t.body, sortOrder: t.sortOrder, isActive: t.isActive });

export async function listNoteTemplates(module?: string, activeOnly = false) {
  return prisma.noteTemplate.findMany({
    where: { ...(module ? { module } : {}), ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ module: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
  });
}

export async function saveNoteTemplate(actor: CurrentUser, id: string | null, d: Data, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    if (!id) {
      const t = await tx.noteTemplate.create({ data: d });
      await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_NOTE_TEMPLATE, entityId: t.id, action: "CREATE", after: snap(d), ip });
      return t;
    }
    const before = await tx.noteTemplate.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "ไม่พบหมายเหตุ");
    const t = await tx.noteTemplate.update({ where: { id }, data: d });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_NOTE_TEMPLATE,
      entityId: id,
      action: "UPDATE",
      before: snap({ ...before, module: before.module as Data["module"] }),
      after: snap(d),
      ip,
    });
    return t;
  });
}

/** ลบได้เสมอ: เอกสารเก็บข้อความที่คัดลอกไปแล้ว ไม่ได้อ้างอิงหมายเหตุสำเร็จรูป */
export async function deleteNoteTemplate(actor: CurrentUser, id: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.noteTemplate.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "ไม่พบหมายเหตุ");
    await tx.noteTemplate.delete({ where: { id } });
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_NOTE_TEMPLATE,
      entityId: id,
      action: "DELETE",
      before: snap({ ...before, module: before.module as Data["module"] }),
      ip,
    });
  });
}
