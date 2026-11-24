import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { canPickContacts } from "@/lib/contact-rules";
import type { Prisma } from "@/generated/prisma/client";

export type ContactOption = { id: string; code: string; name: string; isCustomer: boolean; isVendor: boolean };


/** ค้นหาผู้ติดต่อ: ?q=&customer=1 (เฉพาะลูกค้า) &vendor=1 (เฉพาะผู้ขาย) */
export const GET = apiHandler({}, async ({ req, user }) => {
  if (!canPickContacts(user.permissions)) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const where: Prisma.ContactWhereInput = { deletedAt: null };
  if (req.nextUrl.searchParams.get("customer") === "1") where.isCustomer = true;
  if (req.nextUrl.searchParams.get("vendor") === "1") where.isVendor = true;
  if (q) {
    const contains = { contains: q, mode: "insensitive" as const };
    where.OR = [{ name: contains }, { code: contains }, { taxId: contains }];
  }
  const rows = await prisma.contact.findMany({
    where,
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, code: true, name: true, isCustomer: true, isVendor: true },
  });
  return rows satisfies ContactOption[];
});
