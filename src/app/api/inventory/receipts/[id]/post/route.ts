import { apiHandler } from "@/lib/api";
import { postReceiptDoc } from "@/server/goods-receipts";

type P = { id: string };

/** กด "นำเข้า": เขียน stock movement */
export const POST = apiHandler<P>({ perm: ["inventory.receipt", "edit"] }, async ({ user, params, ip }) => {
  await postReceiptDoc(user, params.id, ip);
  return { ok: true };
});
