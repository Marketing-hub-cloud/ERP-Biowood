import { apiHandler, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { companySchema } from "@/lib/validators";
import { ENTITY_COMPANY, getCompany } from "@/server/company";

export const GET = apiHandler({ perm: ["settings.company", "view"] }, async () => getCompany());

export const PUT = apiHandler({ perm: ["settings.company", "edit"] }, async ({ req, user, ip }) => {
  const input = companySchema.parse(await readJson(req));
  await prisma.$transaction(async (tx) => {
    const before = await tx.companySetting.findUnique({ where: { id: 1 } });
    const after = await tx.companySetting.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
    await writeAudit(tx, {
      actorId: user.id,
      entityType: ENTITY_COMPANY,
      entityId: "1",
      action: before ? "UPDATE" : "CREATE",
      before,
      after,
      ip,
    });
  });
  return { ok: true };
});
