// Logic tree แบบ pure (ใช้ทั้ง client/server): สถานที่จัดเก็บ + หมวดหมู่สินค้า

export type TreeNode = {
  id: string;
  parentId: string | null;
  level: number;
  code: string | null;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export type TreeKind = "locations" | "categories";

export const TREE_CONFIG: Record<TreeKind, { rootLevel: number; maxLevel: number; codeRequired: boolean; levelNames: string[]; title: string }> = {
  // คลัง = ระดับ 0 แล้วซ้อนได้อีก 3 ระดับ
  locations: { rootLevel: 0, maxLevel: 3, codeRequired: true, levelNames: ["คลัง", "สถานที่ระดับ 1", "สถานที่ระดับ 2", "สถานที่ระดับ 3"], title: "สถานที่จัดเก็บ" },
  // หมวดหมู่ 1/2/3
  categories: { rootLevel: 1, maxLevel: 3, codeRequired: false, levelNames: ["", "หมวดหมู่ 1", "หมวดหมู่ 2", "หมวดหมู่ 3"], title: "หมวดหมู่สินค้า" },
};

export function sortNodes<T extends TreeNode>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => a.sortOrder - b.sortOrder || (a.code ?? "").localeCompare(b.code ?? "", "th") || a.name.localeCompare(b.name, "th"));
}

export function childrenOf<T extends TreeNode>(nodes: T[], parentId: string | null): T[] {
  return sortNodes(nodes.filter((n) => n.parentId === parentId));
}

/** id ของ node และลูกหลานทั้งหมด */
export function descendantIds(nodes: TreeNode[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const n of nodes) if (n.parentId === out[i]) out.push(n.id);
  return out;
}

/** ความลึกของ subtree (0 = ไม่มีลูก) */
export function subtreeDepth(nodes: TreeNode[], id: string): number {
  const node = nodes.find((n) => n.id === id);
  if (!node) return 0;
  const ids = descendantIds(nodes, id);
  return Math.max(...nodes.filter((n) => ids.includes(n.id)).map((n) => n.level)) - node.level;
}

/** บรรพบุรุษจากราก → ตัวเอง */
export function ancestry<T extends TreeNode>(nodes: T[], id: string | null | undefined): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: T[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && out.length < 10) {
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

export function pathLabel(nodes: TreeNode[], id: string | null | undefined, sep = " > "): string {
  return ancestry(nodes, id)
    .map((n) => n.name)
    .join(sep);
}

/**
 * ตรวจการวาง node ใต้ parent (ทั้งสร้างใหม่และย้าย) คืนข้อความ error หรือ null
 * - movingId: node ที่กำลังย้าย (null = สร้างใหม่)
 */
export function checkPlacement(kind: TreeKind, nodes: TreeNode[], parentId: string | null, movingId: string | null): string | null {
  const cfg = TREE_CONFIG[kind];
  let level = cfg.rootLevel;
  if (parentId) {
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) return "ไม่พบรายการแม่";
    if (movingId && descendantIds(nodes, movingId).includes(parentId)) return "ไม่สามารถย้ายไปอยู่ใต้ตัวเองหรือรายการลูกของตัวเองได้";
    level = parent.level + 1;
  }
  const depth = movingId ? subtreeDepth(nodes, movingId) : 0;
  if (level + depth > cfg.maxLevel) {
    return `ซ้อนได้ลึกสุด ${cfg.maxLevel - cfg.rootLevel + 1} ระดับ`;
  }
  return null;
}

/** ระดับใหม่ของ node และลูกหลานหลังย้าย: id -> level */
export function relevel(nodes: TreeNode[], movingId: string, newLevel: number): Map<string, number> {
  const node = nodes.find((n) => n.id === movingId)!;
  const delta = newLevel - node.level;
  const ids = descendantIds(nodes, movingId);
  return new Map(nodes.filter((n) => ids.includes(n.id)).map((n) => [n.id, n.level + delta]));
}

/** แปลงเป็นรายการเรียงแบบ depth-first พร้อมระดับ (ใช้แสดง dropdown/tree) */
export function flattenTree<T extends TreeNode>(nodes: T[], parentId: string | null = null): T[] {
  const out: T[] = [];
  for (const n of childrenOf(nodes, parentId)) {
    out.push(n);
    out.push(...flattenTree(nodes, n.id));
  }
  return out;
}

export function isTreeKind(kind: string): kind is TreeKind {
  return kind === "locations" || kind === "categories";
}
