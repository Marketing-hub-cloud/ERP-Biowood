import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { fullName } from "@/lib/format";
import { openRequestLines } from "@/server/purchase-requests";

/**
 * สำหรับสร้าง/แก้ใบสั่งซื้อ:
 * - ?ids=pr1,pr2 → รายการคงค้างของ PR เหล่านั้น (&excludeOrder= ไม่นับ PO ใบที่กำลังแก้)
 * - ไม่ระบุ ids → รายชื่อ PR ที่อนุมัติแล้วและยังสั่งซื้อไม่ครบ (?q=)
 */
export const GET = apiHandler({}, async ({ req, user }) => {
  if (!can(user.permissions, "purchase.order", "create") && !can(user.permissions, "purchase.order", "edit")) {
    throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  }
  const sp = req.nextUrl.searchParams;
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean).slice(0, 50);
  if (ids.length) return openRequestLines(ids, sp.get("excludeOrder"));
  const q = (sp.get("q") ?? "").trim();
  const docs = await prisma.purchaseRequest.findMany({
    where: {
      status: { in: ["APPROVED", "PARTIAL"] },
      ...(q ? { OR: [{ docNo: { contains: q, mode: "insensitive" } }, { requester: { firstName: { contains: q, mode: "insensitive" } } }] } : {}),
    },
    include: { requester: { select: { firstName: true, lastName: true } } },
    orderBy: { docNo: "desc" },
    take: 50,
  });
  return docs.map((d) => ({ id: d.id, docNo: d.docNo, docDate: d.docDate.toISOString(), requester: fullName(d.requester), status: d.status }));
});
