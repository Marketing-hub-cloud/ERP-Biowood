import { ApiError, apiHandler, readJson } from "@/lib/api";
import { workPlanSchema } from "@/lib/validators";
import { getPlan, updatePlan } from "@/server/work-plans";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["crm.plan", "view"] }, async ({ params }) => {
  const p = await getPlan(params.id);
  if (!p) throw new ApiError(404, "ไม่พบแผนการทำงาน");
  return p;
});

/** สิทธิ์ละเอียด (แก้ไข หรือเจ้าของแผน) ตรวจใน updatePlan */
export const PATCH = apiHandler<P>({ perm: ["crm.plan", "view"] }, async ({ req, user, params, ip }) => {
  await updatePlan(user, params.id, workPlanSchema.parse(await readJson(req)), ip);
  return { ok: true };
});
