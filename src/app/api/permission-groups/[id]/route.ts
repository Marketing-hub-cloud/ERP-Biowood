import { ApiError, apiHandler, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rowToFlags } from "@/lib/rbac";
import { groupSchema } from "@/lib/validators";
import { deleteGroup, updateGroup } from "@/server/groups";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["users.group", "view"] }, async ({ params }) => {
  const g = await prisma.permissionGroup.findUnique({
    where: { id: params.id },
    include: { permissions: true, members: { select: { userId: true } } },
  });
  if (!g) throw new ApiError(404, "ไม่พบกลุ่มสิทธิ์");
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    permissions: Object.fromEntries(g.permissions.map((p) => [p.menuKey, rowToFlags(p)])),
    memberIds: g.members.map((m) => m.userId),
  };
});

export const PATCH = apiHandler<P>({ perm: ["users.group", "edit"] }, async ({ req, user, params, ip }) => {
  const input = groupSchema.parse(await readJson(req));
  await updateGroup(user, params.id, input, ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({ perm: ["users.group", "delete"] }, async ({ user, params, ip }) => {
  await deleteGroup(user, params.id, ip);
  return { ok: true };
});
