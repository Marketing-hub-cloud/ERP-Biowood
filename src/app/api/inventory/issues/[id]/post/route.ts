import { apiHandler } from "@/lib/api";
import { postIssueDoc } from "@/server/goods-issues";

type P = { id: string };

/** กด "นำออก": ตรวจยอดแบบ lock แล้วเขียน stock movement */
export const POST = apiHandler<P>({ perm: ["inventory.issue", "edit"] }, async ({ user, params, ip }) => {
  await postIssueDoc(user, params.id, ip);
  return { ok: true };
});
