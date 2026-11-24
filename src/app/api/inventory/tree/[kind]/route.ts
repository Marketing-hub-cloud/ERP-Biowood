import { ApiError, apiHandler, readJson } from "@/lib/api";
import { treeNodeSchema } from "@/lib/validators";
import { isTreeKind, type TreeKind } from "@/lib/tree";
import { createTreeNode, listTree } from "@/server/inventory-settings";

type P = { kind: string };

function parseKind(kind: string): TreeKind {
  if (!isTreeKind(kind)) throw new ApiError(404, "ไม่พบข้อมูล");
  return kind;
}

export const GET = apiHandler<P>({ perm: ["settings.inventory", "view"] }, async ({ params }) => listTree(parseKind(params.kind)));

export const POST = apiHandler<P>({ perm: ["settings.inventory", "edit"] }, async ({ req, user, params, ip }) => {
  const kind = parseKind(params.kind);
  const d = treeNodeSchema.parse(await readJson(req));
  const node = await createTreeNode(user, kind, d, ip);
  return { id: node.id };
});
