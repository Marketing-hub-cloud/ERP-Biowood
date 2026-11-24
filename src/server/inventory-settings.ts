import "server-only";
import { z } from "zod";
import { prisma, type TxClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { checkPlacement, relevel, TREE_CONFIG, type TreeKind, type TreeNode } from "@/lib/tree";
import { attributeSchema, treeNodeSchema, unitSchema } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";

export const ENTITY_BY_TREE: Record<TreeKind, string> = { locations: "StockLocation", categories: "ProductCategory" };
export const ENTITY_UNIT = "Unit";
export const ENTITY_ATTRIBUTE = "ProductAttribute";

type TreeData = z.output<typeof treeNodeSchema>;

// ───────────── Tree (สถานที่จัดเก็บ / หมวดหมู่) ─────────────

/** adapter ให้ใช้ logic เดียวกันกับ 2 ตาราง */
function treeRepo(tx: TxClient, kind: TreeKind) {
  if (kind === "locations") {
    return {
      all: () => tx.stockLocation.findMany() as Promise<TreeNode[]>,
      create: (data: Omit<TreeNode, "id">) => tx.stockLocation.create({ data: { ...data, code: data.code! } }),
      update: (id: string, data: Partial<Omit<TreeNode, "id">>) =>
        tx.stockLocation.update({ where: { id }, data: { ...data, code: data.code === null ? undefined : data.code } }),
      remove: (id: string) => tx.stockLocation.delete({ where: { id } }),
    };
  }
  return {
    all: () => tx.productCategory.findMany() as Promise<TreeNode[]>,
    create: (data: Omit<TreeNode, "id">) => tx.productCategory.create({ data }),
    update: (id: string, data: Partial<Omit<TreeNode, "id">>) => tx.productCategory.update({ where: { id }, data }),
    remove: (id: string) => tx.productCategory.delete({ where: { id } }),
  };
}

export async function listTree(kind: TreeKind): Promise<TreeNode[]> {
  return prisma.$transaction((tx) => treeRepo(tx, kind).all());
}

/** จำนวนการใช้งาน (ลูก + ข้อมูลที่อ้างอิง) — ใช้ตัดสินว่าลบได้หรือไม่ */
async function treeUsage(tx: TxClient, kind: TreeKind, id: string, nodes: TreeNode[]) {
  const children = nodes.filter((n) => n.parentId === id).length;
  // TODO(เฟส 4): นับ stock movement ที่อ้างอิงสถานที่นี้
  const refs = kind === "categories" ? await tx.product.count({ where: { categoryId: id } }) : 0;
  return { children, refs };
}

function assertUniqueSibling(kind: TreeKind, nodes: TreeNode[], parentId: string | null, d: TreeData, exceptId?: string) {
  const siblings = nodes.filter((n) => n.parentId === parentId && n.id !== exceptId);
  if (kind === "locations" && siblings.some((n) => n.code === d.code)) {
    throw new ApiError(409, "รหัสนี้ซ้ำกับรายการอื่นในระดับเดียวกัน", { code: "รหัสซ้ำในระดับเดียวกัน" });
  }
  if (kind === "categories" && siblings.some((n) => n.name === d.name)) {
    throw new ApiError(409, "ชื่อนี้ซ้ำกับหมวดหมู่อื่นในระดับเดียวกัน", { name: "ชื่อซ้ำในระดับเดียวกัน" });
  }
}

const snapshotNode = (n: TreeNode, nodes: TreeNode[]) => ({
  code: n.code,
  name: n.name,
  parent: nodes.find((p) => p.id === n.parentId)?.name ?? null,
  level: n.level,
  isActive: n.isActive,
  sortOrder: n.sortOrder,
});

export async function createTreeNode(actor: CurrentUser, kind: TreeKind, d: TreeData, ip: string | null) {
  const cfg = TREE_CONFIG[kind];
  if (cfg.codeRequired && !d.code) throw new ApiError(400, "กรุณากรอกรหัส", { code: "กรุณากรอกรหัส" });
  return prisma.$transaction(async (tx) => {
    const repo = treeRepo(tx, kind);
    const nodes = await repo.all();
    const err = checkPlacement(kind, nodes, d.parentId, null);
    if (err) throw new ApiError(400, err, { parentId: err });
    assertUniqueSibling(kind, nodes, d.parentId, d);
    const level = d.parentId ? nodes.find((n) => n.id === d.parentId)!.level + 1 : cfg.rootLevel;
    const node = await repo.create({ parentId: d.parentId, level, code: d.code, name: d.name, isActive: d.isActive, sortOrder: d.sortOrder });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_BY_TREE[kind], entityId: node.id, action: "CREATE", after: snapshotNode(node, nodes), ip });
    return node;
  });
}

export async function updateTreeNode(actor: CurrentUser, kind: TreeKind, id: string, d: TreeData, ip: string | null) {
  const cfg = TREE_CONFIG[kind];
  if (cfg.codeRequired && !d.code) throw new ApiError(400, "กรุณากรอกรหัส", { code: "กรุณากรอกรหัส" });
  return prisma.$transaction(async (tx) => {
    const repo = treeRepo(tx, kind);
    const nodes = await repo.all();
    const node = nodes.find((n) => n.id === id);
    if (!node) throw new ApiError(404, "ไม่พบข้อมูล");
    const moved = node.parentId !== d.parentId;
    if (moved) {
      const err = checkPlacement(kind, nodes, d.parentId, id);
      if (err) throw new ApiError(400, err, { parentId: err });
    }
    assertUniqueSibling(kind, nodes, d.parentId, d, id);
    const newLevel = d.parentId ? nodes.find((n) => n.id === d.parentId)!.level + 1 : cfg.rootLevel;
    const updated = await repo.update(id, { parentId: d.parentId, level: newLevel, code: d.code, name: d.name, isActive: d.isActive, sortOrder: d.sortOrder });
    if (moved) {
      for (const [nid, lvl] of relevel(nodes, id, newLevel)) if (nid !== id) await repo.update(nid, { level: lvl });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      entityType: ENTITY_BY_TREE[kind],
      entityId: id,
      action: "UPDATE",
      before: snapshotNode(node, nodes),
      after: snapshotNode({ ...node, ...updated, code: updated.code ?? null }, nodes),
      ip,
    });
    return updated;
  });
}

export async function deleteTreeNode(actor: CurrentUser, kind: TreeKind, id: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const repo = treeRepo(tx, kind);
    const nodes = await repo.all();
    const node = nodes.find((n) => n.id === id);
    if (!node) throw new ApiError(404, "ไม่พบข้อมูล");
    const u = await treeUsage(tx, kind, id, nodes);
    if (u.children) throw new ApiError(400, "ลบไม่ได้ เพราะมีรายการย่อยอยู่ กรุณาลบหรือย้ายรายการย่อยก่อน");
    if (u.refs) throw new ApiError(400, `ลบไม่ได้ เพราะมีสินค้าใช้อยู่ ${u.refs} รายการ (ใช้ "ปิดใช้งาน" แทน)`);
    await repo.remove(id);
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_BY_TREE[kind], entityId: id, action: "DELETE", before: snapshotNode(node, nodes), ip });
  });
}

// ───────────── หน่วย ─────────────

export async function saveUnit(actor: CurrentUser, id: string | null, d: z.output<typeof unitSchema>, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const dup = await tx.unit.findUnique({ where: { name: d.name } });
    if (dup && dup.id !== id) throw new ApiError(409, "หน่วยนี้มีอยู่แล้ว", { name: "หน่วยนี้มีอยู่แล้ว" });
    if (!id) {
      const u = await tx.unit.create({ data: d });
      await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_UNIT, entityId: u.id, action: "CREATE", after: d, ip });
      return u;
    }
    const before = await tx.unit.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "ไม่พบหน่วย");
    const u = await tx.unit.update({ where: { id }, data: d });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_UNIT, entityId: id, action: "UPDATE", before, after: u, ip });
    return u;
  });
}

export async function deleteUnit(actor: CurrentUser, id: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.unit.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "ไม่พบหน่วย");
    const n = await tx.product.count({ where: { stockUnitId: id } });
    if (n) throw new ApiError(400, `ลบไม่ได้ เพราะมีสินค้าใช้หน่วยนี้อยู่ ${n} รายการ (ใช้ "ปิดใช้งาน" แทน)`);
    await tx.unit.delete({ where: { id } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_UNIT, entityId: id, action: "DELETE", before, ip });
  });
}

// ───────────── คุณสมบัติ ─────────────

export async function saveAttribute(actor: CurrentUser, id: string | null, d: z.output<typeof attributeSchema>, ip: string | null) {
  return prisma.$transaction(async (tx) => {
    const dup = await tx.productAttribute.findUnique({ where: { name: d.name } });
    if (dup && dup.id !== id) throw new ApiError(409, "ชื่อคุณสมบัตินี้มีอยู่แล้ว", { name: "ชื่อนี้มีอยู่แล้ว" });
    if (!id) {
      const a = await tx.productAttribute.create({ data: d });
      await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_ATTRIBUTE, entityId: a.id, action: "CREATE", after: d, ip });
      return a;
    }
    const before = await tx.productAttribute.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "ไม่พบคุณสมบัติ");
    const used = await tx.productAttributeValue.findMany({ where: { attributeId: id }, select: { value: true }, distinct: ["value"] });
    if (used.length && before.dataType !== d.dataType) {
      throw new ApiError(400, "เปลี่ยนชนิดข้อมูลไม่ได้ เพราะมีสินค้าใช้คุณสมบัตินี้อยู่", { dataType: "มีสินค้าใช้อยู่" });
    }
    if (d.dataType === "SELECT") {
      const removedInUse = used.map((u) => u.value).filter((v) => !d.options.includes(v));
      if (removedInUse.length) {
        throw new ApiError(400, `ลบตัวเลือกไม่ได้ เพราะมีสินค้าใช้อยู่: ${removedInUse.join(", ")}`, { options: "มีตัวเลือกที่สินค้าใช้อยู่" });
      }
    }
    const a = await tx.productAttribute.update({ where: { id }, data: d });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_ATTRIBUTE, entityId: id, action: "UPDATE", before, after: a, ip });
    return a;
  });
}

export async function deleteAttribute(actor: CurrentUser, id: string, ip: string | null) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.productAttribute.findUnique({ where: { id } });
    if (!before) throw new ApiError(404, "ไม่พบคุณสมบัติ");
    const n = await tx.productAttributeValue.count({ where: { attributeId: id } });
    if (n) throw new ApiError(400, `ลบไม่ได้ เพราะมีสินค้าใช้คุณสมบัตินี้อยู่ ${n} รายการ (ใช้ "ปิดใช้งาน" แทน)`);
    await tx.productAttribute.delete({ where: { id } });
    await writeAudit(tx, { actorId: actor.id, entityType: ENTITY_ATTRIBUTE, entityId: id, action: "DELETE", before, ip });
  });
}

/** ข้อมูลทั้งหมดของหน้าตั้งค่าคลัง + จำนวนการใช้งาน */
export async function getInventorySettings() {
  const [locations, categories, units, attributes, catUse, unitUse, attrUse] = await Promise.all([
    prisma.stockLocation.findMany(),
    prisma.productCategory.findMany(),
    prisma.unit.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.productAttribute.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.product.groupBy({ by: ["categoryId"], _count: true }),
    prisma.product.groupBy({ by: ["stockUnitId"], _count: true }),
    prisma.productAttributeValue.groupBy({ by: ["attributeId"], _count: true }),
  ]);
  const map = <K extends string>(rows: ({ _count: number } & Record<K, string | null>)[], k: K) =>
    Object.fromEntries(rows.filter((r) => r[k]).map((r) => [r[k] as string, r._count]));
  return {
    locations: locations as TreeNode[],
    categories: categories as TreeNode[],
    units: units.map((u) => ({ id: u.id, name: u.name, isActive: u.isActive, sortOrder: u.sortOrder })),
    attributes: attributes.map((a) => ({
      id: a.id,
      name: a.name,
      dataType: a.dataType,
      options: a.options,
      unitLabel: a.unitLabel,
      isRequired: a.isRequired,
      isActive: a.isActive,
      sortOrder: a.sortOrder,
    })),
    usage: {
      categories: map(catUse, "categoryId"),
      units: map(unitUse, "stockUnitId"),
      attributes: map(attrUse, "attributeId"),
    },
  };
}
export type InventorySettings = Awaited<ReturnType<typeof getInventorySettings>>;
