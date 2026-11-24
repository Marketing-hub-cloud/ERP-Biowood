import { apiHandler } from "@/lib/api";
import { storage } from "@/lib/storage";
import { removeProductImage, setPrimaryImage } from "@/server/products";

type P = { id: string; imageId: string };

/** ตั้งเป็นรูปหลัก */
export const PATCH = apiHandler<P>({ perm: ["inventory.product", "edit"] }, async ({ user, params, ip }) => {
  await setPrimaryImage(user, params.id, params.imageId, ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({ perm: ["inventory.product", "edit"] }, async ({ user, params, ip }) => {
  const key = await removeProductImage(user, params.id, params.imageId, ip);
  await storage.remove(key);
  return { ok: true };
});
