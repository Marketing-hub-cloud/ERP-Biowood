import { z } from "zod";
import { apiHandler, readJson } from "@/lib/api";
import { scanSchema } from "@/lib/validators";
import { scanReceiptSerial } from "@/server/goods-receipts";

type P = { id: string };

/** สแกน SN: { barcode, undo? } */
export const POST = apiHandler<P>({ perm: ["inventory.receipt", "edit"] }, async ({ req, user, params }) => {
  const d = scanSchema.extend({ undo: z.boolean().optional() }).parse(await readJson(req));
  return scanReceiptSerial(user, params.id, d.barcode, Boolean(d.undo));
});
