import { ApiError, apiHandler, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { lookupSchema } from "@/lib/validators";
import { can } from "@/lib/rbac";
import { canManageContactOptions } from "@/server/contacts";

// เพิ่มตัวเลือกใหม่จากในฟอร์ม (พิมพ์แล้วกด "เพิ่ม") — ถ้ามีอยู่แล้วคืนตัวเดิม
export const POST = apiHandler({}, async ({ req, user }) => {
  const { kind, label } = lookupSchema.parse(await readJson(req));
  // ประเภทสินค้า: ผู้สร้าง/แก้ไขสินค้าได้ / เหตุผลการคืน: ผู้สร้าง/แก้ไขใบส่งคืนได้ / ตัวเลือกผู้ติดต่อ: ผู้สร้าง/แก้ไขผู้ติดต่อได้
  const docMenu = kind === "PRODUCT_TYPE" ? "inventory.product" : kind === "RETURN_REASON" ? "purchase.return" : null;
  const allowed = docMenu ? can(user.permissions, docMenu, "create") || can(user.permissions, docMenu, "edit") : canManageContactOptions(user);
  if (!allowed) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const o = await prisma.lookupOption.upsert({
    where: { kind_label: { kind, label } },
    update: { isActive: true },
    create: { kind, label },
  });
  return { id: o.id, label: o.label };
});
