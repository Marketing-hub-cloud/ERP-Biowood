import { apiHandler, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { markReadSchema } from "@/lib/validators";

/** อ่านแล้ว: { ids: [...] } หรือ { all: true } — เฉพาะแจ้งเตือนของตัวเอง */
export const POST = apiHandler({}, async ({ req, user }) => {
  const d = markReadSchema.parse(await readJson(req));
  const where = { userId: user.id, readAt: null, ...(d.all ? {} : { id: { in: d.ids ?? [] } }) };
  const r = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  return { updated: r.count, unread };
});
