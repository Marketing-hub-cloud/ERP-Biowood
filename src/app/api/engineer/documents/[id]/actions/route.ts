import { ApiError, apiHandler, readJson } from "@/lib/api";
import { can } from "@/lib/rbac";
import { engineerActionSchema } from "@/lib/validators";
import { advanceEngineerDoc, cancelEngineerDoc } from "@/server/engineer-docs";

type P = { id: string };

/**
 * { action: "advance", from, comment? } → ไปขั้นถัดไป (สิทธิ์ตามแต่ละ transition ใน src/lib/engineer-workflow.ts)
 * { action: "cancel", comment } → ยกเลิก (สิทธิ์ "ยกเลิก")
 */
export const POST = apiHandler<P>({ perm: ["engineer.document", "view"] }, async ({ req, user, params, ip }) => {
  const d = engineerActionSchema.parse(await readJson(req));
  const comment = d.comment?.trim() || null;
  if (d.action === "cancel") {
    if (!can(user.permissions, "engineer.document", "cancel")) throw new ApiError(403, "ไม่มีสิทธิ์ยกเลิกเอกสาร");
    if (!comment) throw new ApiError(400, "กรุณากรอกเหตุผลการยกเลิก", { comment: "กรุณากรอกเหตุผล" });
    await cancelEngineerDoc(user, params.id, comment, ip);
    return { ok: true, status: "CANCELLED" };
  }
  if (!d.from) throw new ApiError(400, "กรุณาระบุขั้นปัจจุบัน");
  return advanceEngineerDoc(user, params.id, d.from, comment, ip);
});
