import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import { fileUrl } from "@/lib/storage";
import { descendantIds, pathLabel, type TreeNode } from "@/lib/tree";
import { productSchema } from "@/lib/validators";
import { createProduct } from "@/server/products";
import { productOnHand } from "@/server/stock";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["code", "name", "createdAt", "updatedAt"];

export type ProductRow = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  productType: string | null;
  category: string | null;
  unit: string | null;
  isStockable: boolean;
  isActive: boolean;
  onHand: number;
  createdAt: string;
};

const include = {
  images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: 1 },
  productType: true,
  stockUnit: true,
  attributeValues: { include: { attribute: true } },
} satisfies Prisma.ProductInclude;

export const GET = apiHandler({ perm: ["inventory.product", "view"] }, async ({ req }) => {
  const p = parseListParams(req, SORTABLE);
  const categories = (await prisma.productCategory.findMany()) as TreeNode[];
  const and: Prisma.ProductWhereInput[] = [{ deletedAt: null }];
  if (p.filters.type) and.push({ productTypeId: p.filters.type });
  if (p.filters.category) and.push({ categoryId: { in: descendantIds(categories, p.filters.category) } });
  if (p.filters.stockable === "yes") and.push({ isStockable: true });
  if (p.filters.stockable === "no") and.push({ isStockable: false });
  if (p.filters.status === "active") and.push({ isActive: true });
  if (p.filters.status === "inactive") and.push({ isActive: false });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({ OR: [{ code: contains }, { name: contains }, { description: contains }, { attributeValues: { some: { value: contains } } }] });
  }
  const where: Prisma.ProductWhereInput = { AND: and };
  const orderBy: Prisma.ProductOrderByWithRelationInput = p.sort ? { [p.sort.field]: p.sort.dir } : { code: "asc" };

  type Row = Prisma.ProductGetPayload<{ include: typeof include }>;
  const toRow = (r: Row, onHand: Map<string, number>): ProductRow => ({
    id: r.id,
    code: r.code,
    name: r.name,
    imageUrl: fileUrl(r.images[0]?.key),
    productType: r.productType?.label ?? null,
    category: pathLabel(categories, r.categoryId) || null,
    unit: r.stockUnit?.name ?? null,
    isStockable: r.isStockable,
    isActive: r.isActive,
    onHand: onHand.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
  });

  if (p.format === "csv") {
    const [rows, attrs] = await Promise.all([
      prisma.product.findMany({ where, orderBy, include }),
      prisma.productAttribute.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    ]);
    const onHand = await productOnHand(rows.map((r) => r.id));
    const csv = toCsv(rows, [
      { header: "รหัสสินค้า", value: (r) => r.code },
      { header: "ชื่อ", value: (r) => r.name },
      { header: "ประเภทสินค้า", value: (r) => r.productType?.label },
      { header: "หมวดหมู่", value: (r) => pathLabel(categories, r.categoryId) },
      { header: "หน่วยสต๊อก", value: (r) => r.stockUnit?.name },
      { header: "สต๊อกได้", value: (r) => (r.isStockable ? "ใช่" : "ไม่ใช่") },
      { header: "สถานะ", value: (r) => (r.isActive ? "ใช้งาน" : "ปิดใช้งาน") },
      ...attrs.map((a) => ({
        header: a.unitLabel ? `${a.name} (${a.unitLabel})` : a.name,
        value: (r: Row) => r.attributeValues.find((v) => v.attributeId === a.id)?.value,
      })),
      { header: "คงเหลือ", value: (r) => (r.isStockable ? (onHand.get(r.id) ?? 0) : "") },
      { header: "รายละเอียด", value: (r) => r.description },
      { header: "วันที่สร้าง", value: (r) => formatDateTime(r.createdAt) },
    ]);
    return csvResponse(csv, "products.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  const onHand = await productOnHand(rows.map((r) => r.id));
  return { rows: rows.map((r) => toRow(r, onHand)), total, page: p.page, pageSize: p.pageSize } satisfies ListResult<ProductRow>;
});

export const POST = apiHandler({ perm: ["inventory.product", "create"] }, async ({ req, user, ip }) => {
  const d = productSchema.parse(await readJson(req));
  const p = await createProduct(user, d, ip);
  return { id: p.id };
});
