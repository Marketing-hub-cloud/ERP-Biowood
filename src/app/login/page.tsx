import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  const callbackUrl = typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/";
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 to-green-100 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Biowood" width={580} height={186} className="mx-auto mb-3 h-14 w-auto" />
          <h1 className="text-xl font-semibold">ระบบ ERP</h1>
          <p className="text-sm text-muted-foreground">เข้าสู่ระบบเพื่อใช้งาน</p>
        </div>
        <LoginForm callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
