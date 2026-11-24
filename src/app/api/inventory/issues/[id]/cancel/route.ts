import { apiHandler, readJson } from "@/lib/api";
import { cancelDocSchema } from "@/lib/validators";
import { cancelIssueDoc } from "@/server/goods-issues";

type P = { id: string };

export const POST = apiHandler<P>({ perm: ["inventory.issue", "cancel"] }, async ({ req, user, params, ip }) => {
  const d = cancelDocSchema.parse(await readJson(req));
  await cancelIssueDoc(user, params.id, d.reason, ip);
  return { ok: true };
});
