import { apiHandler, readJson } from "@/lib/api";
import { unitSchema } from "@/lib/validators";
import { saveUnit } from "@/server/inventory-settings";

export const POST = apiHandler({ perm: ["settings.inventory", "edit"] }, async ({ req, user, ip }) => {
  const u = await saveUnit(user, null, unitSchema.parse(await readJson(req)), ip);
  return { id: u.id };
});
