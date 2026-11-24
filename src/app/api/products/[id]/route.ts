import { apiHandler, readJson } from "@/lib/api";
import { productSchema } from "@/lib/validators";
import { deleteProduct, getProductOr404, updateProduct } from "@/server/products";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["inventory.product", "view"] }, async ({ params }) => getProductOr404(params.id));

export const PATCH = apiHandler<P>({ perm: ["inventory.product", "edit"] }, async ({ req, user, params, ip }) => {
  await updateProduct(user, params.id, productSchema.parse(await readJson(req)), ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({ perm: ["inventory.product", "delete"] }, async ({ user, params, ip }) => {
  await deleteProduct(user, params.id, ip);
  return { ok: true };
});
