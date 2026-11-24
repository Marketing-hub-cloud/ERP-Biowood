import { apiHandler } from "@/lib/api";
import { retryDelivery } from "@/server/notification-settings";

type P = { id: string };

/** ส่งซ้ำรายการที่ล้ม/รอส่ง */
export const POST = apiHandler<P>({ perm: ["settings.notification", "edit"] }, async ({ params }) => {
  await retryDelivery(params.id);
  return { ok: true };
});
