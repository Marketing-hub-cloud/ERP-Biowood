import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { openReturnLines } from "@/server/purchase-returns";

/** ตัวเลือกใบส่งคืนสำหรับใบนำออกประเภท "ส่งคืน": ?q= รายชื่อที่อนุมัติแล้วและยังคืนไม่ครบ, ?id= รายการคงค้าง */
export const GET = apiHandler({}, async ({ req, user }) => {
  if (!can(user.permissions, "inventory.issue", "create") && !can(user.permissions, "inventory.issue", "edit")) {
    throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  }
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  if (id) {
    const r = await openReturnLines(id);
    if (!r) throw new ApiError(404, "ไม่พบใบส่งคืน หรือใบส่งคืนยังไม่อนุมัติ");
    return r;
  }
  const q = (sp.get("q") ?? "").trim();
  const docs = await prisma.purchaseReturn.findMany({
    where: {
      status: { in: ["APPROVED", "PARTIAL"] },
      ...(q ? { OR: [{ docNo: { contains: q, mode: "insensitive" } }, { vendor: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    include: { vendor: { select: { name: true } } },
    orderBy: { docNo: "desc" },
    take: 50,
  });
  return docs.map((d) => ({ id: d.id, docNo: d.docNo, vendor: d.vendor.name, status: d.status }));
});
