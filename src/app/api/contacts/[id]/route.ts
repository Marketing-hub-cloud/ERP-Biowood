import { apiHandler, readJson } from "@/lib/api";
import { contactSchema } from "@/lib/validators";
import { deleteContact, getContactFor, updateContact } from "@/server/contacts";

type P = { id: string };

// สิทธิ์ตรวจตามบทบาทของผู้ติดต่อใน server/contacts.ts (ลูกค้า/ผู้ขาย)
export const GET = apiHandler<P>({}, async ({ user, params }) => getContactFor(user, params.id, "view"));

export const PATCH = apiHandler<P>({}, async ({ req, user, params, ip }) => {
  const data = contactSchema.parse(await readJson(req));
  await updateContact(user, params.id, data, ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({}, async ({ user, params, ip }) => {
  await deleteContact(user, params.id, ip);
  return { ok: true };
});
