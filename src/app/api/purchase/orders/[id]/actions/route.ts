import { apiHandler, readJson } from "@/lib/api";
import { handlePurchaseAction } from "@/server/purchase-actions";

type P = { id: string };

/** { action: submit | approve | reject | cancel, comment? } */
export const POST = apiHandler<P>({ perm: ["purchase.order", "view"] }, async ({ req, user, params, ip }) =>
  handlePurchaseAction("PO", user, params.id, await readJson(req), ip),
);
