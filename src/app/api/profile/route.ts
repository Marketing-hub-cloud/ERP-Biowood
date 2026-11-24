import { apiHandler, readJson } from "@/lib/api";
import { profileSchema } from "@/lib/validators";
import { updateProfile } from "@/server/users";

// ผู้ใช้ทุกคนแก้ข้อมูลของตัวเองได้ (ไม่ต้องมีสิทธิ์เมนู)
export const PATCH = apiHandler({}, async ({ req, user, ip }) => {
  const input = profileSchema.parse(await readJson(req));
  await updateProfile(user, input, ip);
  return { ok: true };
});
