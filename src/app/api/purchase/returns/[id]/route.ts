import { ApiError, apiHandler, readJson } from "@/lib/api";
import { purchaseReturnSchema } from "@/lib/validators";
import { getReturnDetail, updateReturn } from "@/server/purchase-returns";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["purchase.return", "view"] }, async ({ params }) => {
  const d = await getReturnDetail(params.id);
  if (!d) throw new ApiError(404, "ไม่พบใบส่งคืน");
  return { ...d.doc, issued: Object.fromEntries(d.issued), history: d.history };
});

export const PATCH = apiHandler<P>({ perm: ["purchase.return", "edit"] }, async ({ req, user, params, ip }) => {
  await updateReturn(user, params.id, purchaseReturnSchema.parse(await readJson(req)), ip);
  return { ok: true };
});
