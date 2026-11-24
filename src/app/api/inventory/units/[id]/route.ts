import { apiHandler, readJson } from "@/lib/api";
import { unitSchema } from "@/lib/validators";
import { deleteUnit, saveUnit } from "@/server/inventory-settings";

type P = { id: string };

export const PATCH = apiHandler<P>({ perm: ["settings.inventory", "edit"] }, async ({ req, user, params, ip }) => {
  await saveUnit(user, params.id, unitSchema.parse(await readJson(req)), ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({ perm: ["settings.inventory", "edit"] }, async ({ user, params, ip }) => {
  await deleteUnit(user, params.id, ip);
  return { ok: true };
});
