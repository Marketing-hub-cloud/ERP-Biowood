import { apiHandler, readJson } from "@/lib/api";
import { changePasswordSchema } from "@/lib/validators";
import { changeOwnPassword } from "@/server/users";

export const POST = apiHandler({}, async ({ req, user, ip }) => {
  const input = changePasswordSchema.parse(await readJson(req));
  await changeOwnPassword(user, input.currentPassword, input.password, ip);
  return { ok: true };
});
