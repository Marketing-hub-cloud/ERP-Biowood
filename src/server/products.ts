import "server-only";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { pathLabel, type TreeNode } from "@/lib/tree";
import { normalizeAttributeValue, validateAttributeValues, type AttributeDef } from "@/lib/product-rules";
import type { ProductData } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";
import { productStockUsage } from "./stock";

export const ENTITY_PRODUCT = "Product";
export const MAX_PRODUCT_IMAGES = 10;

export const productInclude = {
  images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  attributeValues: { include: { attribute: true } },
  productType: true,
  stockUnit: true,
  category: true,
} satisfies Prisma.ProductInclude;
export type ProductFull = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export async function getProductOr404(id: string) {
  const p = await prisma.product.findFirst({ where: { id, deletedAt: null }, include: productInclude });
  if (!p) throw new ApiError(404, "ไม่พบสินค้า");
  return p;
}

async function snapshot(tx: TxClient, id: string) {
  const p = await tx.product.findUniqueOrThrow({ where: { id }, include: productInclude });
  const cats = await tx.productCategory.findMany();
  return {
    code: p.code,
    name: p.name,
    productType: p.productType?.label ?? null,
    category: pathLabel(cats as TreeNode[], p.categoryId) || null,
    description: p.description,
    isStockable: p.isStockable,
    stockUnit: p.stockUnit?.name ?? null,
    isActive: p.isActive,
    attributes: Object.fromEntries(
      p.attributeValues.sort((a, b) => a.attribute.name.localeCompare(b.attribute.name, "th")).map((v) => [v.attribute.name, v.value]),
    ),
    images: p.images.length,
  };
}

async function assertRefs(tx: TxClient, d: ProductData, current?: { productTypeId: string | null; categoryId: string | null; stockUnitId: string | null }) {
  // อนุญาตค่าเดิมที่ถูกปิดใช้งานไปแล้ว แต่ค่าใหม่ต้องเปิดใช้งาน
  if (d.productTypeId && d.productTypeId !== current?.productTypeId) {
    const o = await tx.lookupOption.findFirst({ where: { id: d.productTypeId, kind: "PRODUCT_TYPE", isActive: true } });
    if (!o) throw new ApiError(400, "ไม่พบประเภทสินค้า", { productTypeId: "ไม่พบประเภทสินค้า" });
  }
  if (d.categoryId && d.categoryId !== current?.categoryId) {
    const c = await tx.productCategory.findFirst({ where: { id: d.categoryId, isActive: true } });
    if (!c) throw new ApiError(400, "ไม่พบหมวดหมู่", { categoryId: "ไม่พบหมวดหมู่" });
  }
  if (d.stockUnitId && d.stockUnitId !== current?.stockUnitId) {
    const u = await tx.unit.findFirst({ where: { id: d.stockUnitId, isActive: true } });
    if (!u) throw new ApiError(400, "ไม่พบหน่วย", { stockUnitId: "ไม่พบหน่วย" });
  }
}

/** ตรวจ + บันทึกค่าคุณสมบัติ (เฉพาะคุณสมบัติที่เปิดใช้งาน ค่าของคุณสมบัติที่ปิดไปแล้วเก็บไว้เหมือนเดิม) */
async function writeAttributes(tx: TxClient, productId: string, values: Record<string, string>) {
  const defs = (await tx.productAttribute.findMany()) as AttributeDef[];
  const errors = validateAttributeValues(defs, values);
  if (Object.keys(errors).length) {
    throw new ApiError(400, "ข้อมูลเฉพาะไม่ถูกต้อง", Object.fromEntries(Object.entries(errors).map(([k, v]) => [`attributes.${k}`, v])));
  }
  for (const def of defs.filter((d) => d.isActive)) {
    const v = normalizeAttributeValue(def, values[def.id] ?? "");
    const key = { productId_attributeId: { productId, attributeId: def.id } };
    if (v) await tx.productAttributeValue.upsert({ where: key, create: { productId, attributeId: def.id, value: v }, update: { value: v } });
    else await tx.productAttributeValue.deleteMany({ where: { productId, attributeId: def.id } });
  }
}

async function assertCodeFree(tx: TxClient, code: string, exceptId?: string) {
  const dup = await tx.product.findUnique({ where: { code } });
  if (dup && dup.id !== exceptId) {
    throw new ApiError(409, dup.deletedAt ? "รหัสสินค้านี้เคยใช้กับสินค้าที่ถูกลบแล้ว" : "รหัสสินค้านี้ถูกใช้แล้ว", { code: "รหัสนี้ถูกใช้แล้ว" });
  }
}

const scalar = (d: ProductData) => ({
  code: d.code,
  name: d.name,
  productTypeId: d.productTypeId,
  categoryId: d.categoryId,
  description: d.description,
  isStockable: d.isStockable,
  stockUnitId: d.stockUnitId,
  isActive: d.isActive,
});

export async function createProduct(actor: CurrentUser, d: ProductData, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    await assertCodeFree(tx, d.code);
    await assertRefs(tx, d);
    const p = await tx.product.create({ data: { ...scalar(d), createdById: actor.id } });
    await writeAttributes(tx, p.id, d.attributes);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PRODUCT, entityId: p.id, action: "CREATE", after: await snapshot(tx, p.id), ip });
    return p;
  });
}

export async function updateProduct(actor: CurrentUser, id: string, d: ProductData, ip: string | null) {
  const current = await getProductOr404(id);
  return prisma.$transaction(async (tx) => {
    // มีความเคลื่อนไหวในคลังหรือเอกสารคลังแล้ว: ห้ามเปลี่ยนหน่วยสต๊อก / ปิด "สต๊อกได้"
    if (d.stockUnitId !== current.stockUnitId || (current.isStockable && !d.isStockable)) {
      const u = await productStockUsage(tx, id);
      if (u.movements || u.documents) {
        const msg = "สินค้านี้มีความเคลื่อนไหวในคลังหรืออยู่ในเอกสารคลังแล้ว";
        if (d.stockUnitId !== current.stockUnitId) throw new ApiError(400, `เปลี่ยนหน่วยสต๊อกไม่ได้ เพราะ${msg}`, { stockUnitId: "เปลี่ยนไม่ได้ เพราะมีความเคลื่อนไหวแล้ว" });
        throw new ApiError(400, `ปิด "สต๊อกได้" ไม่ได้ เพราะ${msg}`, { isStockable: "ปิดไม่ได้ เพราะมีความเคลื่อนไหวแล้ว" });
      }
    }
    if (d.code !== current.code) await assertCodeFree(tx, d.code, id);
    await assertRefs(tx, d, current);
    const before = await snapshot(tx, id);
    await tx.product.update({ where: { id }, data: scalar(d) });
    await writeAttributes(tx, id, d.attributes);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PRODUCT, entityId: id, action: "UPDATE", before, after: await snapshot(tx, id), ip });
  });
}

export async function deleteProduct(actor: CurrentUser, id: string, ip: string | null) {
  await getProductOr404(id);
  await prisma.$transaction(async (tx) => {
    const u = await productStockUsage(tx, id);
    if (u.movements || u.documents) throw new ApiError(400, "ลบไม่ได้ เพราะสินค้านี้มีความเคลื่อนไหวในคลังหรืออยู่ในเอกสารคลังแล้ว (ใช้ \"ปิดใช้งาน\" แทน)");
    const before = await snapshot(tx, id);
    await tx.product.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PRODUCT, entityId: id, action: "DELETE", before, ip });
  });
}

export async function addProductImage(actor: CurrentUser, id: string, key: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const count = await tx.productImage.count({ where: { productId: id } });
    if (count >= MAX_PRODUCT_IMAGES) throw new ApiError(400, `อัปโหลดได้สูงสุด ${MAX_PRODUCT_IMAGES} รูป`);
    await tx.productImage.create({ data: { productId: id, key, sortOrder: count } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PRODUCT, entityId: id, action: "UPDATE", note: "เพิ่มรูปสินค้า", force: true, ip });
  });
}

export async function removeProductImage(actor: CurrentUser, id: string, imageId: string, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const img = await tx.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!img) throw new ApiError(404, "ไม่พบรูป");
    await tx.productImage.delete({ where: { id: imageId } });
    const rest = await tx.productImage.findMany({ where: { productId: id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    for (const [i, r] of rest.entries()) if (r.sortOrder !== i) await tx.productImage.update({ where: { id: r.id }, data: { sortOrder: i } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PRODUCT, entityId: id, action: "UPDATE", note: "ลบรูปสินค้า", force: true, ip });
    return img.key;
  });
}

/** ตั้งรูปหลัก: ย้ายรูปที่เลือกไปลำดับแรก */
export async function setPrimaryImage(actor: CurrentUser, id: string, imageId: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const imgs = await tx.productImage.findMany({ where: { productId: id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    if (!imgs.some((i) => i.id === imageId)) throw new ApiError(404, "ไม่พบรูป");
    const ordered = [imgs.find((i) => i.id === imageId)!, ...imgs.filter((i) => i.id !== imageId)];
    for (const [i, r] of ordered.entries()) await tx.productImage.update({ where: { id: r.id }, data: { sortOrder: i } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_PRODUCT, entityId: id, action: "UPDATE", note: "เปลี่ยนรูปหลัก", force: true, ip });
  });
}

/** ตัวเลือกสำหรับฟอร์มสินค้า */
export async function getProductFormOptions() {
  const [types, categories, units, attributes] = await Promise.all([
    prisma.lookupOption.findMany({ where: { kind: "PRODUCT_TYPE" }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.productCategory.findMany(),
    prisma.unit.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.productAttribute.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  return {
    productTypes: types.map((t) => ({ id: t.id, label: t.label, isActive: t.isActive })),
    categories: categories as TreeNode[],
    units: units.map((u) => ({ id: u.id, name: u.name, isActive: u.isActive })),
    attributes: attributes.map((a) => ({
      id: a.id,
      name: a.name,
      dataType: a.dataType,
      options: a.options,
      unitLabel: a.unitLabel,
      isRequired: a.isRequired,
      isActive: a.isActive,
    })),
  };
}
export type ProductFormOptions = Awaited<ReturnType<typeof getProductFormOptions>>;
