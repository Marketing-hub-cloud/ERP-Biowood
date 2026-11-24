import { ApiError, apiHandler, readJson } from "@/lib/api";
import { purchaseRequestSchema } from "@/lib/validators";
import { getRequestDetail, updateRequest } from "@/server/purchase-requests";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["purchase.request", "view"] }, async ({ params }) => {
  const d = await getRequestDetail(params.id);
  if (!d) throw new ApiError(404, "ไม่พบใบขอซื้อ");
  return { ...d.doc, ordered: Object.fromEntries(d.ordered), history: d.history };
});

export const PATCH = apiHandler<P>({ perm: ["purchase.request", "edit"] }, async ({ req, user, params, ip }) => {
  await updateRequest(user, params.id, purchaseRequestSchema.parse(await readJson(req)), ip);
  return { ok: true };
});
