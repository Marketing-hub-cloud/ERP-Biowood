import { ApiError, apiHandler, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { userUpdateSchema } from "@/lib/validators";
import { updateUser } from "@/server/users";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["users.account", "view"] }, async ({ params }) => {
  const u = await prisma.user.findUnique({
    where: { id: params.id },
    omit: { passwordHash: true },
    include: { groups: { select: { groupId: true } } },
  });
  if (!u) throw new ApiError(404, "ไม่พบผู้ใช้");
  const { groups, ...rest } = u;
  return { ...rest, groupIds: groups.map((g) => g.groupId) };
});

export const PATCH = apiHandler<P>({ perm: ["users.account", "edit"] }, async ({ req, user, params, ip }) => {
  const input = userUpdateSchema.parse(await readJson(req));
  await updateUser(user, params.id, input, ip);
  return { ok: true };
});
