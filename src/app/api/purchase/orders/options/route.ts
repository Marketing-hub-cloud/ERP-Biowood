import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { openOrderLines, returnableLines } from "@/server/purchase-orders";
import type { Prisma } from "@/generated/prisma/client";

/**
 * ตัวเลือกใบสั่งซื้อสำหรับเอกสารปลายทาง:
 * - ?purpose=receipt → PO ที่อนุมัติแล้วและยังรับไม่ครบ (ใบนำเข้าประเภทสั่งซื้อ) &id= → รายการคงค้าง
 * - ?purpose=return  → PO ที่มีการนำเข้าแล้ว (ใบส่งคืน) &id= → รายการที่คืนได้ (&excludeReturn=)
 */
export const GET = apiHandler({}, async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const purpose = sp.get("purpose") === "return" ? "return" : "receipt";
  const menu = purpose === "receipt" ? "inventory.receipt" : "purchase.return";
  if (!can(user.permissions, menu, "create") && !can(user.permissions, menu, "edit")) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");

  const id = sp.get("id");
  if (id) {
    const r = purpose === "receipt" ? await openOrderLines(id) : await returnableLines(id, sp.get("excludeReturn"));
    if (!r) throw new ApiError(404, "ไม่พบใบสั่งซื้อ หรือใบสั่งซื้อยังไม่อนุมัติ");
    return r;
  }
  const q = (sp.get("q") ?? "").trim();
  const where: Prisma.PurchaseOrderWhereInput = {
    status: { in: purpose === "receipt" ? ["APPROVED", "PARTIAL"] : ["PARTIAL", "COMPLETED"] },
    ...(q ? { OR: [{ docNo: { contains: q, mode: "insensitive" } }, { vendor: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const docs = await prisma.purchaseOrder.findMany({ where, include: { vendor: { select: { name: true } } }, orderBy: { docNo: "desc" }, take: 50 });
  return docs.map((d) => ({ id: d.id, docNo: d.docNo, vendor: d.vendor.name, status: d.status, warehouseId: d.warehouseId }));
});
