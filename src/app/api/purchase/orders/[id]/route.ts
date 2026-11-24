import { ApiError, apiHandler, readJson } from "@/lib/api";
import { purchaseOrderSchema } from "@/lib/validators";
import { getOrderDetail, updateOrder } from "@/server/purchase-orders";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["purchase.order", "view"] }, async ({ params }) => {
  const d = await getOrderDetail(params.id);
  if (!d) throw new ApiError(404, "ไม่พบใบสั่งซื้อ");
  return { ...d.doc, received: Object.fromEntries(d.received), returned: Object.fromEntries(d.returned), history: d.history };
});

export const PATCH = apiHandler<P>({ perm: ["purchase.order", "edit"] }, async ({ req, user, params, ip }) => {
  await updateOrder(user, params.id, purchaseOrderSchema.parse(await readJson(req)), ip);
  return { ok: true };
});
