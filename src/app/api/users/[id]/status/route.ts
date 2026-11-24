import { apiHandler, readJson } from "@/lib/api";
import { userStatusSchema } from "@/lib/validators";
import { setUserStatus } from "@/server/users";

// "หยุดใช้งาน" / "เปิดใช้งาน" ใช้สิทธิ์ cancel ของเมนูบัญชีผู้ใช้
export const POST = apiHandler<{ id: string }>({ perm: ["users.account", "cancel"] }, async ({ req, user, params, ip }) => {
  const input = userStatusSchema.parse(await readJson(req));
  await setUserStatus(user, params.id, input, ip);
  return { ok: true };
});
