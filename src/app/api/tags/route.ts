import { ApiError, apiHandler, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { tagSchema } from "@/lib/validators";
import { canManageContactOptions } from "@/server/contacts";

// เพิ่มกลุ่ม (tag) ใหม่ — ถ้ามีอยู่แล้วคืนตัวเดิม
export const POST = apiHandler({}, async ({ req, user }) => {
  if (!canManageContactOptions(user)) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const { name } = tagSchema.parse(await readJson(req));
  const t = await prisma.tag.upsert({ where: { name }, update: {}, create: { name } });
  return { id: t.id, name: t.name };
});
