import "server-only";
import type { TxClient } from "@/lib/db";
import { ApiError } from "@/lib/errors";

/** เลือกได้เฉพาะคลัง (ระดับ 0) ที่เปิดใช้งาน — ค่าเดิมที่ปิดไปแล้วยังบันทึกซ้ำได้ */
export async function assertWarehouse(tx: TxClient, warehouseId: string | null, current?: string | null) {
  if (!warehouseId || warehouseId === current) return;
  const wh = await tx.stockLocation.findFirst({ where: { id: warehouseId, level: 0, isActive: true } });
  if (!wh) throw new ApiError(400, "ไม่พบคลัง", { warehouseId: "ไม่พบคลัง" });
}

/** สินค้าต้องมีอยู่และเปิดใช้งาน (สินค้าที่อยู่ในเอกสารเดิมแล้วปิดใช้งานภายหลัง ยังบันทึกซ้ำได้) */
export async function assertProducts(tx: TxClient, productIds: string[], keep: Set<string> = new Set()) {
  const products = await tx.product.findMany({ where: { id: { in: [...new Set(productIds)] } } });
  const fields: Record<string, string> = {};
  productIds.forEach((id, i) => {
    const p = products.find((x) => x.id === id);
    if (!p || p.deletedAt) fields[`lines.${i}.productId`] = "ไม่พบสินค้า";
    else if (!p.isActive && !keep.has(id)) fields[`lines.${i}.productId`] = "สินค้านี้ปิดใช้งานแล้ว";
  });
  if (Object.keys(fields).length) throw new ApiError(400, Object.values(fields)[0], fields);
  return products;
}

/** ผู้ขายต้องเป็นผู้ติดต่อที่ติ๊ก "ผู้ขาย" และยังไม่ถูกลบ */
export async function assertVendor(tx: TxClient, vendorId: string) {
  const v = await tx.contact.findFirst({ where: { id: vendorId, deletedAt: null } });
  if (!v) throw new ApiError(400, "ไม่พบผู้ขาย", { vendorId: "ไม่พบผู้ขาย" });
  if (!v.isVendor) throw new ApiError(400, "ผู้ติดต่อนี้ไม่ได้เป็นผู้ขาย", { vendorId: "ผู้ติดต่อนี้ไม่ได้เป็นผู้ขาย" });
  return v;
}

/** lock เอกสารที่ต้องเป็นร่าง (แก้ไขได้เฉพาะร่าง) */
export async function lockDraft(tx: TxClient, table: "purchase_requests" | "purchase_orders" | "purchase_returns", id: string) {
  const rows =
    table === "purchase_requests"
      ? await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM purchase_requests WHERE id = ${id} FOR UPDATE`
      : table === "purchase_orders"
        ? await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM purchase_orders WHERE id = ${id} FOR UPDATE`
        : await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM purchase_returns WHERE id = ${id} FOR UPDATE`;
  if (!rows[0]) throw new ApiError(404, "ไม่พบเอกสาร");
  if (rows[0].status !== "DRAFT") throw new ApiError(409, "แก้ไขได้เฉพาะเอกสารที่เป็นร่าง (ถ้าถูกส่งอนุมัติแล้ว ต้องให้ผู้อนุมัติกด \"ไม่อนุมัติ\" ก่อน)");
  return rows[0].status;
}

export const PURCHASE_TX = { maxWait: 10_000, timeout: 30_000 } as const;

/** จุดส่งแจ้งเตือน (ในระบบ + LINE "Biowood - จัดซื้อ") — ทำจริงในเฟส 6 */
export type PurchaseEvent = { docType: "PR" | "PO" | "RT"; docId: string; docNo: string; event: string; actorName: string };
// TODO(เฟส 6): เขียนลงคิวแจ้งเตือน (background job + retry) ห้ามทำให้การบันทึกเอกสารล้ม
export function notifyPurchaseEvent(e: PurchaseEvent) {
  void e;
}

/** ตัวเลือกของฟอร์มเอกสารจัดซื้อ: ผู้ใช้ (ผู้ขอ), สินค้า, คลัง */
export async function getPurchaseFormOptions() {
  const { prisma } = await import("@/lib/db");
  const { fullName } = await import("@/lib/format");
  const [users, products, warehouses] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, department: true, position: true, status: true },
      orderBy: [{ status: "asc" }, { firstName: "asc" }],
    }),
    prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, isActive: true, stockUnit: { select: { name: true } } },
    }),
    prisma.stockLocation.findMany({ where: { level: 0 }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
  ]);
  return {
    users: users.map((u) => ({ id: u.id, name: fullName(u), department: u.department, position: u.position, inactive: u.status !== "ACTIVE" })),
    products: products.map((p) => ({ id: p.id, code: p.code, name: p.name, isActive: p.isActive, unit: p.stockUnit?.name ?? "" })),
    warehouses: warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name, isActive: w.isActive })),
  };
}
export type PurchaseFormOptions = Awaited<ReturnType<typeof getPurchaseFormOptions>>;
