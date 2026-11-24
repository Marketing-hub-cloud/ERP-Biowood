import { z } from "zod";
import { apiHandler, readJson } from "@/lib/api";
import { issueSchema } from "@/lib/validators";
import { getIssueOr404, updateIssue } from "@/server/goods-issues";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["inventory.issue", "view"] }, async ({ params }) => getIssueOr404(params.id));

/** แก้ไขร่าง: body + { post?: true } = บันทึกแล้วนำออกทันที */
export const PATCH = apiHandler<P>({ perm: ["inventory.issue", "edit"] }, async ({ req, user, params, ip }) => {
  const body = await readJson(req);
  const post = z.object({ post: z.boolean().optional() }).parse(body).post ?? false;
  await updateIssue(user, params.id, issueSchema.parse(body), post, ip);
  return { ok: true };
});
