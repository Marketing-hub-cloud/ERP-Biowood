import { ApiError, apiHandler, readJson } from "@/lib/api";
import { engineerDocSchema } from "@/lib/validators";
import { getEngineerDetail, updateEngineerDoc } from "@/server/engineer-docs";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["engineer.document", "view"] }, async ({ params }) => {
  const d = await getEngineerDetail(params.id);
  if (!d) throw new ApiError(404, "ไม่พบใบถอดแบบ/ติดตั้ง");
  return { ...d.doc, steps: d.steps };
});

export const PATCH = apiHandler<P>({ perm: ["engineer.document", "edit"] }, async ({ req, user, params, ip }) => {
  await updateEngineerDoc(user, params.id, engineerDocSchema.parse(await readJson(req)), ip);
  return { ok: true };
});
