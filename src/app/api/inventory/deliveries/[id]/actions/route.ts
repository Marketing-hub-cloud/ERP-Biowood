import { apiHandler, readJson } from "@/lib/api";
import { deliveryActionSchema } from "@/lib/validators";
import { runDeliveryAction } from "@/server/deliveries";

type P = { id: string };

/** { action: deliver | cancel (+ reason) } — สิทธิ์ละเอียดตรวจใน checkDeliveryAction */
export const POST = apiHandler<P>({ perm: ["inventory.delivery", "view"] }, async ({ req, user, params, ip }) => {
  const d = deliveryActionSchema.parse(await readJson(req));
  return runDeliveryAction(user, params.id, d.action, d.reason, ip);
});
