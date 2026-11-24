import { apiHandler, readJson } from "@/lib/api";
import { attributeSchema } from "@/lib/validators";
import { saveAttribute } from "@/server/inventory-settings";

export const POST = apiHandler({ perm: ["settings.inventory", "edit"] }, async ({ req, user, ip }) => {
  const a = await saveAttribute(user, null, attributeSchema.parse(await readJson(req)), ip);
  return { id: a.id };
});
