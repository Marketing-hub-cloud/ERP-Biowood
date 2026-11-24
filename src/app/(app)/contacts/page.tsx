import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { rolesWith } from "@/lib/contact-rules";

// /contacts → แท็บแรกที่ผู้ใช้มีสิทธิ์
export default async function ContactsIndex() {
  const user = await requireUser();
  const roles = rolesWith(user.permissions, "view");
  if (roles.length === 0) redirect("/forbidden");
  redirect(roles.length > 1 ? "/contacts/all" : roles[0] === "customer" ? "/contacts/customers" : "/contacts/vendors");
}
