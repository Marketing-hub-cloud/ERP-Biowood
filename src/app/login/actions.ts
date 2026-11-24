"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type LoginState = { error?: string };

function safeCallback(url: FormDataEntryValue | null): string {
  const s = typeof url === "string" ? url : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safeCallback(formData.get("callbackUrl")),
    });
    return {};
  } catch (err) {
    if (err instanceof AuthError) {
      const code = (err as AuthError & { code?: string }).code;
      if (code === "inactive") return { error: "บัญชีนี้ถูกหยุดใช้งาน กรุณาติดต่อผู้ดูแลระบบ" };
      return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
    }
    throw err; // redirect หลังล็อกอินสำเร็จ
  }
}
