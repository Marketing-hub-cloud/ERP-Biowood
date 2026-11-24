import { ApiError, apiHandler, readJson } from "@/lib/api";
import { isTreeKind, type TreeKind } from "@/lib/tree";
import { treeNodeSchema } from "@/lib/validators";
import { deleteTreeNode, updateTreeNode } from "@/server/inventory-settings";

function parseKind(kind: string): TreeKind {
  if (!isTreeKind(kind)) throw new ApiError(404, "ไม่พบข้อมูล");
  return kind;
}

type P = { kind: string; id: string };

export const PATCH = apiHandler<P>({ perm: ["settings.inventory", "edit"] }, async ({ req, user, params, ip }) => {
  const d = treeNodeSchema.parse(await readJson(req));
  await updateTreeNode(user, parseKind(params.kind), params.id, d, ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({ perm: ["settings.inventory", "edit"] }, async ({ user, params, ip }) => {
  await deleteTreeNode(user, parseKind(params.kind), params.id, ip);
  return { ok: true };
});
