import { apiHandler } from "@/lib/api";
import { storage } from "@/lib/storage";
import { saveImageUpload } from "@/lib/upload";
import { getContactFor, setContactPhoto } from "@/server/contacts";

type P = { id: string };

export const POST = apiHandler<P>({}, async ({ req, user, params, ip }) => {
  await getContactFor(user, params.id, "edit"); // ตรวจสิทธิ์ก่อนรับไฟล์
  const key = await saveImageUpload(req, "contacts");
  const old = await setContactPhoto(user, params.id, key, ip);
  if (old) await storage.remove(old);
  return { photoKey: key };
});

export const DELETE = apiHandler<P>({}, async ({ user, params, ip }) => {
  const old = await setContactPhoto(user, params.id, null, ip);
  if (old) await storage.remove(old);
  return { ok: true };
});
