import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { canPickContacts } from "@/lib/contact-rules";

type P = { id: string };

export type ContactPersonOption = { id: string; name: string; position: string | null; phone: string | null; isPrimary: boolean };

/** บุคคลติดต่อของผู้ติดต่อ (เลือกในโครงการ) */
export const GET = apiHandler<P>({}, async ({ user, params }) => {
  if (!canPickContacts(user.permissions)) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const rows = await prisma.contactPerson.findMany({
    where: { contactId: params.id, contact: { deletedAt: null } },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
    select: { id: true, name: true, position: true, phone: true, isPrimary: true },
  });
  return rows satisfies ContactPersonOption[];
});
