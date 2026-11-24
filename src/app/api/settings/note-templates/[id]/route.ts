import { apiHandler, readJson } from "@/lib/api";
import { noteTemplateSchema } from "@/lib/validators";
import { deleteNoteTemplate, saveNoteTemplate } from "@/server/note-templates";

type P = { id: string };

export const PATCH = apiHandler<P>({ perm: ["settings.remark", "edit"] }, async ({ req, user, params, ip }) => {
  await saveNoteTemplate(user, params.id, noteTemplateSchema.parse(await readJson(req)), ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({ perm: ["settings.remark", "delete"] }, async ({ user, params, ip }) => {
  await deleteNoteTemplate(user, params.id, ip);
  return { ok: true };
});
