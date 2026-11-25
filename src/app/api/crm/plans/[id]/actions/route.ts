import { apiHandler, readJson } from "@/lib/api";
import { planActionSchema } from "@/lib/validators";
import { runPlanAction } from "@/server/work-plans";

type P = { id: string };

/** { action: checkin_start | checkin_end (+ lat, lng, accuracy) | complete | cancel (+ reason) } — สิทธิ์ตรวจใน checkPlanAction */
export const POST = apiHandler<P>({ perm: ["crm.plan", "view"] }, async ({ req, user, params, ip }) =>
  runPlanAction(user, params.id, planActionSchema.parse(await readJson(req)), ip),
);
