import { apiHandler } from "@/lib/api";
import { storage } from "@/lib/storage";
import { saveImageUpload } from "@/lib/upload";
import { addProductImage, getProductOr404 } from "@/server/products";

export const POST = apiHandler<{ id: string }>({ perm: ["inventory.product", "edit"] }, async ({ req, user, params, ip }) => {
  await getProductOr404(params.id);
  const key = await saveImageUpload(req, "products");
  try {
    await addProductImage(user, params.id, key, ip);
  } catch (e) {
    await storage.remove(key);
    throw e;
  }
  return { key };
});
