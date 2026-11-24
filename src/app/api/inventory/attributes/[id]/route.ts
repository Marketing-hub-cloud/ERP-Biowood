import { apiHandler, readJson } from "@/lib/api";
import { attributeSchema } from "@/lib/validators";
import { deleteAttribute, saveAttribute } from "@/server/inventory-settings";

type P = { id: string };

export const PATCH = apiHandler<P>({ perm: ["settings.inventory", "edit"] }, async ({ req, user, params, ip }) => {
  await saveAttribute(user, params.id, attributeSchema.parse(await readJson(req)), ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({ perm: ["settings.inventory", "edit"] }, async ({ user, params, ip }) => {
  await deleteAttribute(user, params.id, ip);
  return { ok: true };
});
