import { apiHandler, readJson } from "@/lib/api";
import { cancelDocSchema } from "@/lib/validators";
import { cancelReceiptDoc } from "@/server/goods-receipts";

type P = { id: string };

export const POST = apiHandler<P>({ perm: ["inventory.receipt", "cancel"] }, async ({ req, user, params, ip }) => {
  const d = cancelDocSchema.parse(await readJson(req));
  await cancelReceiptDoc(user, params.id, d.reason, ip);
  return { ok: true };
});
