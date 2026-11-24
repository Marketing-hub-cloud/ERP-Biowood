import "server-only";
import { prisma, type DbClient, type TxClient } from "@/lib/db";
import { pathLabel, type TreeNode } from "@/lib/tree";

export type StockRow = {
  serialId: string;
  barcode: string;
  warehouse: string;
  location: string;
  lot: string | null;
  balance: number;
};

/** ยอดคงเหลือของสินค้า แยกตาม คลัง / สถานที่ / Lot / SN (เฉพาะที่ยังเหลือ) */
export async function productStock(productId: string): Promise<StockRow[]> {
  const rows = await prisma.$queryRaw<{ serialId: string; qty: string }[]>`
    SELECT "serialId", SUM(quantity)::text AS qty FROM stock_movements
    WHERE "productId" = ${productId} GROUP BY "serialId" HAVING SUM(quantity) <> 0`;
  if (!rows.length) return [];
  const [serials, nodes] = await Promise.all([
    prisma.stockSerial.findMany({ where: { id: { in: rows.map((r) => r.serialId) } }, include: { warehouse: true } }),
    prisma.stockLocation.findMany(),
  ]);
  const qty = new Map(rows.map((r) => [r.serialId, Number(r.qty)]));
  return serials
    .map((s) => ({
      serialId: s.id,
      barcode: s.barcode,
      warehouse: s.warehouse?.name ?? "",
      // สถานที่แสดงเป็น path ใต้คลัง (ไม่ซ้ำชื่อคลัง)
      location: s.locationId && s.locationId !== s.warehouseId ? pathLabel(nodes as TreeNode[], s.locationId).split(" > ").slice(1).join(" > ") : "-",
      lot: s.lot,
      balance: qty.get(s.id) ?? 0,
    }))
    .sort((a, b) => a.warehouse.localeCompare(b.warehouse, "th") || a.location.localeCompare(b.location, "th") || a.barcode.localeCompare(b.barcode));
}

/** คงเหลือรวมต่อสินค้า */
export async function productOnHand(productIds: string[]): Promise<Map<string, number>> {
  if (!productIds.length) return new Map();
  const rows = await prisma.$queryRaw<{ productId: string; qty: string }[]>`
    SELECT "productId", SUM(quantity)::text AS qty FROM stock_movements WHERE "productId" = ANY(${productIds}) GROUP BY "productId"`;
  return new Map(rows.map((r) => [r.productId, Number(r.qty)]));
}

/** สินค้ามีความเคลื่อนไหวในคลัง หรืออยู่ในใบนำเข้า/นำออกที่ยังไม่ยกเลิก */
export async function productStockUsage(db: DbClient | TxClient, productId: string) {
  // เรียกทีละคำสั่ง (อาจอยู่ใน transaction ซึ่งใช้ connection เดียว)
  const movements = await db.stockMovement.count({ where: { productId } });
  const receiptLines = await db.goodsReceiptLine.count({ where: { productId, receipt: { status: { not: "CANCELLED" } } } });
  const issueLines = await db.goodsIssueLine.count({ where: { productId, issue: { status: { not: "CANCELLED" } } } });
  return { movements, documents: receiptLines + issueLines };
}

/** จำนวนการอ้างอิงสถานที่ (ใบนำเข้า + SN + movement) ต่อ id */
export async function locationUsage(db: DbClient | TxClient, ids?: string[]): Promise<Record<string, number>> {
  const filter = ids ? { in: ids } : { not: null };
  const wh = await db.goodsReceipt.groupBy({ by: ["warehouseId"], _count: true, where: ids ? { warehouseId: { in: ids } } : undefined });
  const lines = await db.goodsReceiptLine.groupBy({ by: ["locationId"], _count: true, where: { locationId: filter as { in: string[] } } });
  const movLoc = await db.stockMovement.groupBy({ by: ["locationId"], _count: true, where: { locationId: filter as { in: string[] } } });
  const movWh = await db.stockMovement.groupBy({ by: ["warehouseId"], _count: true, where: ids ? { warehouseId: { in: ids } } : undefined });
  const out: Record<string, number> = {};
  const add = (id: string | null, n: number) => {
    if (id) out[id] = (out[id] ?? 0) + n;
  };
  wh.forEach((r) => add(r.warehouseId, r._count));
  lines.forEach((r) => add(r.locationId, r._count));
  movLoc.forEach((r) => add(r.locationId, r._count));
  movWh.forEach((r) => add(r.warehouseId, r._count));
  return out;
}
