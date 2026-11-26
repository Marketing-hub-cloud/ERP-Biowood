import { ApiError, apiHandler, readJson } from "@/lib/api";
import { deliveryJobSchema } from "@/lib/validators";
import { getDelivery, updateDelivery } from "@/server/deliveries";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["inventory.delivery", "view"] }, async ({ params }) => {
  const d = await getDelivery(params.id);
  if (!d) throw new ApiError(404, "ไม่พบงานจัดส่ง");
  return d;
});

export const PATCH = apiHandler<P>({ perm: ["inventory.delivery", "edit"] }, async ({ req, user, params, ip }) => {
  await updateDelivery(user, params.id, deliveryJobSchema.parse(await readJson(req)), ip);
  return { ok: true };
});
