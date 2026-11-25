import { ApiError, apiHandler, readJson } from "@/lib/api";
import { projectSchema } from "@/lib/validators";
import { deleteProject, getProject, updateProject } from "@/server/projects";

type P = { id: string };

export const GET = apiHandler<P>({ perm: ["crm.project", "view"] }, async ({ params }) => {
  const d = await getProject(params.id);
  if (!d) throw new ApiError(404, "ไม่พบโครงการ");
  return { ...d.project, engineerDocs: d.engineerDocs, plans: d.plans };
});

export const PATCH = apiHandler<P>({ perm: ["crm.project", "edit"] }, async ({ req, user, params, ip }) => {
  await updateProject(user, params.id, projectSchema.parse(await readJson(req)), ip);
  return { ok: true };
});

export const DELETE = apiHandler<P>({ perm: ["crm.project", "delete"] }, async ({ user, params, ip }) => {
  await deleteProject(user, params.id, ip);
  return { ok: true };
});
