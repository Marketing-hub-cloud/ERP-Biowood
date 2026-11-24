import { ApiError, apiHandler, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { lookupSchema } from "@/lib/validators";
import { canManageContactOptions } from "@/server/contacts";

// เพิ่มตัวเลือกใหม่จากในฟอร์ม (พิมพ์แล้วกด "เพิ่ม") — ถ้ามีอยู่แล้วคืนตัวเดิม
export const POST = apiHandler({}, async ({ req, user }) => {
  if (!canManageContactOptions(user)) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const { kind, label } = lookupSchema.parse(await readJson(req));
  const o = await prisma.lookupOption.upsert({
    where: { kind_label: { kind, label } },
    update: { isActive: true },
    create: { kind, label },
  });
  return { id: o.id, label: o.label };
});
