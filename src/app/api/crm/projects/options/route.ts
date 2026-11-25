import { ApiError, apiHandler } from "@/lib/api";
import { can } from "@/lib/rbac";
import { searchProjectOptions } from "@/server/projects";

/** ค้นหาโครงการเพื่อเลือกในแผนการทำงาน/ใบถอดแบบ: ?q=&customerId= */
export const GET = apiHandler({}, async ({ req, user }) => {
  const ok =
    can(user.permissions, "crm.project", "view") ||
    ["crm.plan", "engineer.document"].some((m) => can(user.permissions, m, "create") || can(user.permissions, m, "edit"));
  if (!ok) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const sp = req.nextUrl.searchParams;
  return searchProjectOptions((sp.get("q") ?? "").trim(), sp.get("customerId"));
});
