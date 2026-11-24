import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDateTime, fullName } from "@/lib/format";
import { userCreateSchema } from "@/lib/validators";
import { createUser } from "@/server/users";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["email", "firstName", "department", "position", "status", "createdAt", "lastLoginAt"];

export type UserRow = {
  id: string;
  email: string;
  name: string;
  department: string | null;
  position: string | null;
  isAdmin: boolean;
  status: "ACTIVE" | "INACTIVE";
  statusNote: string | null;
  groups: string[];
  lastLoginAt: string | null;
  createdAt: string;
};

export const GET = apiHandler({ perm: ["users.account", "view"] }, async ({ req }) => {
  const p = parseListParams(req, SORTABLE);
  const where: Prisma.UserWhereInput = {};
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    where.OR = [{ email: contains }, { firstName: contains }, { lastName: contains }, { department: contains }, { position: contains }];
  }
  if (p.filters.status === "ACTIVE" || p.filters.status === "INACTIVE") where.status = p.filters.status;
  if (p.filters.group) where.groups = { some: { groupId: p.filters.group } };
  if (p.filters.department) where.department = p.filters.department;

  const orderBy: Prisma.UserOrderByWithRelationInput = p.sort ? { [p.sort.field]: p.sort.dir } : { createdAt: "desc" };
  const include = { groups: { include: { group: { select: { name: true } } } } } as const;

  const toRow = (u: Prisma.UserGetPayload<{ include: typeof include }>): UserRow => ({
    id: u.id,
    email: u.email,
    name: fullName(u),
    department: u.department,
    position: u.position,
    isAdmin: u.isAdmin,
    status: u.status,
    statusNote: u.statusNote,
    groups: u.groups.map((g) => g.group.name),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  });

  if (p.format === "csv") {
    const users = await prisma.user.findMany({ where, orderBy, include });
    const csv = toCsv(users.map(toRow), [
      { header: "อีเมล", value: (r) => r.email },
      { header: "ชื่อ-นามสกุล", value: (r) => r.name },
      { header: "แผนก", value: (r) => r.department },
      { header: "ตำแหน่ง", value: (r) => r.position },
      { header: "กลุ่มสิทธิ์", value: (r) => (r.isAdmin ? ["ผู้ดูแลระบบ", ...r.groups] : r.groups).join(", ") },
      { header: "สถานะ", value: (r) => (r.status === "ACTIVE" ? "ใช้งาน" : "หยุดใช้งาน") },
      { header: "หมายเหตุสถานะ", value: (r) => r.statusNote },
      { header: "เข้าสู่ระบบล่าสุด", value: (r) => formatDateTime(r.lastLoginAt) },
      { header: "วันที่สร้าง", value: (r) => formatDateTime(r.createdAt) },
    ]);
    return csvResponse(csv, "users.csv");
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return { rows: users.map(toRow), total, page: p.page, pageSize: p.pageSize } satisfies ListResult<UserRow>;
});

export const POST = apiHandler({ perm: ["users.account", "create"] }, async ({ req, user, ip }) => {
  const input = userCreateSchema.parse(await readJson(req));
  const created = await createUser(user, input, ip);
  return { id: created.id };
});
