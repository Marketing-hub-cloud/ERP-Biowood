import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import { groupSchema } from "@/lib/validators";
import { createGroup } from "@/server/groups";
import type { Prisma } from "@/generated/prisma/client";

export type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  menuCount: number;
  updatedAt: string;
};

export const GET = apiHandler({ perm: ["users.group", "view"] }, async ({ req }) => {
  const p = parseListParams(req, ["name", "updatedAt", "createdAt"]);
  const where: Prisma.PermissionGroupWhereInput = p.q
    ? { OR: [{ name: { contains: p.q, mode: "insensitive" } }, { description: { contains: p.q, mode: "insensitive" } }] }
    : {};
  const orderBy: Prisma.PermissionGroupOrderByWithRelationInput = p.sort ? { [p.sort.field]: p.sort.dir } : { name: "asc" };
  const include = { _count: { select: { members: true, permissions: true } } } as const;
  const toRow = (g: Prisma.PermissionGroupGetPayload<{ include: typeof include }>): GroupRow => ({
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: g._count.members,
    menuCount: g._count.permissions,
    updatedAt: g.updatedAt.toISOString(),
  });

  if (p.format === "csv") {
    const rows = (await prisma.permissionGroup.findMany({ where, orderBy, include })).map(toRow);
    return csvResponse(
      toCsv(rows, [
        { header: "ชื่อกลุ่มสิทธิ์", value: (r) => r.name },
        { header: "คำอธิบาย", value: (r) => r.description },
        { header: "จำนวนสมาชิก", value: (r) => r.memberCount },
        { header: "จำนวนเมนูที่เข้าถึงได้", value: (r) => r.menuCount },
        { header: "แก้ไขล่าสุด", value: (r) => formatDateTime(r.updatedAt) },
      ]),
      "permission-groups.csv",
    );
  }

  const [total, groups] = await Promise.all([
    prisma.permissionGroup.count({ where }),
    prisma.permissionGroup.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return { rows: groups.map(toRow), total, page: p.page, pageSize: p.pageSize } satisfies ListResult<GroupRow>;
});

export const POST = apiHandler({ perm: ["users.group", "create"] }, async ({ req, user, ip }) => {
  const input = groupSchema.parse(await readJson(req));
  const g = await createGroup(user, input, ip);
  return { id: g.id };
});
