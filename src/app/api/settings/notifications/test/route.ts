import { z } from "zod";
import { apiHandler, readJson } from "@/lib/api";
import { sendTestMessage } from "@/server/notification-settings";

/** ส่งข้อความทดสอบเข้ากลุ่ม LINE ของโมดูล: { module } */
export const POST = apiHandler({ perm: ["settings.notification", "edit"] }, async ({ req, user }) => {
  const { module } = z.object({ module: z.enum(["purchase", "engineer"]) }).parse(await readJson(req));
  return sendTestMessage(user, module);
});
