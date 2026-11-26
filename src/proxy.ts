import { NextResponse } from "next/server";
import { auth } from "@/auth";

// ด่านแรก: ต้องล็อกอินก่อนเข้าหน้าใดๆ (ยกเว้น /login และ /api/auth)
// การตรวจสถานะผู้ใช้และสิทธิ์จริงทำที่ page / route handler ผ่าน src/lib/session.ts
export const proxy = auth((req) => {
  if (req.auth?.user) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  const url = new URL("/login", req.nextUrl);
  if (req.nextUrl.pathname !== "/") url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/((?!login|api/auth|api/health|api/line/webhook|api/jobs/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
