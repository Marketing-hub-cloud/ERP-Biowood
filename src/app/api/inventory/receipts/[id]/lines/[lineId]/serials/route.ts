import { z } from "zod";
import { apiHandler, readJson } from "@/lib/api";
import { generateSerialsSchema } from "@/lib/validators";
import { deleteSerials, generateSerials } from "@/server/goods-receipts";

type P = { id: string; lineId: string };

/** สร้าง Barcode/SN: { count, qtyPerSerial } */
export const POST = apiHandler<P>({ perm: ["inventory.receipt", "edit"] }, async ({ req, user, params, ip }) => {
  const d = generateSerialsSchema.parse(await readJson(req));
  return generateSerials(user, params.id, params.lineId, d.count, d.qtyPerSerial, ip);
});

/** ลบ SN: { serialIds?: string[] } (ไม่ระบุ = ลบทั้งหมดของรายการ) */
export const DELETE = apiHandler<P>({ perm: ["inventory.receipt", "edit"] }, async ({ req, user, params, ip }) => {
  const d = z.object({ serialIds: z.array(z.string()).max(1000).optional() }).parse(await readJson(req));
  return deleteSerials(user, params.id, params.lineId, d.serialIds ?? null, ip);
});
