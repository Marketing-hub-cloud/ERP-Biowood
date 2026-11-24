import { apiHandler, readJson } from "@/lib/api";
import { receiptSchema } from "@/lib/validators";
import { getReceiptOr404, updateReceipt } from "@/server/goods-receipts";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["inventory.receipt", "view"] }, async ({ params }) => getReceiptOr404(params.id));

export const PATCH = apiHandler<P>({ perm: ["inventory.receipt", "edit"] }, async ({ req, user, params, ip }) => {
  await updateReceipt(user, params.id, receiptSchema.parse(await readJson(req)), ip);
  return { ok: true };
});
