import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentUser, type CurrentUser } from "./session";
import { can } from "./rbac";
import type { PermissionAction } from "./menu";
import { ApiError } from "./errors";

export { ApiError };

export type ApiContext<P> = {
  req: NextRequest;
  user: CurrentUser;
  params: P;
  ip: string | null;
};

type Options = {
  /** [menuKey, action] ที่ต้องมี — ไม่ระบุ = แค่ล็อกอิน */
  perm?: [string, PermissionAction];
};

/**
 * ห่อ Route Handler ทุกตัว: ตรวจล็อกอิน (401), สถานะผู้ใช้, สิทธิ์ (403), แปลง error เป็น JSON
 */
export function apiHandler<P = Record<string, string>>(
  opts: Options,
  fn: (ctx: ApiContext<P>) => Promise<Response | unknown>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }) => {
    try {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
      if (opts.perm && !can(user.permissions, opts.perm[0], opts.perm[1])) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์ใช้งาน" }, { status: 403 });
      }
      const params = (routeCtx?.params ? await routeCtx.params : {}) as P;
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const result = await fn({ req, user, params, ip });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, fields: err.fields }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง", fields }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return NextResponse.json({ error: "ข้อมูลซ้ำกับที่มีอยู่แล้ว" }, { status: 409 });
    if (err.code === "P2025") return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });
  }
  console.error(err);
  return NextResponse.json({ error: "เกิดข้อผิดพลาดในระบบ" }, { status: 500 });
}

/** อ่าน JSON body อย่างปลอดภัย */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "รูปแบบข้อมูลไม่ถูกต้อง");
  }
}

// ───────────── พารามิเตอร์หน้ารายการ (ใช้กับ DataTable) ─────────────

export type ListParams = {
  page: number;
  pageSize: number;
  q: string;
  sort: { field: string; dir: "asc" | "desc" } | null;
  filters: Record<string, string>;
  format: "json" | "csv";
};

export function parseListParams(req: NextRequest, sortable: string[]): ListParams {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 20));
  const [field, dir] = (sp.get("sort") ?? "").split(":");
  const sort = field && sortable.includes(field) ? { field, dir: dir === "desc" ? ("desc" as const) : ("asc" as const) } : null;
  const filters: Record<string, string> = {};
  for (const [k, v] of sp.entries()) if (k.startsWith("f_") && v) filters[k.slice(2)] = v;
  return { page, pageSize, q: (sp.get("q") ?? "").trim(), sort, filters, format: sp.get("format") === "csv" ? "csv" : "json" };
}

export type ListResult<T> = { rows: T[]; total: number; page: number; pageSize: number };
