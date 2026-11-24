import { ApiError, apiHandler, readJson } from "@/lib/api";
import { APPROVAL_DOC_TYPES, type ApprovalDocType } from "@/lib/approval";
import { approvalConfigSchema } from "@/lib/validators";
import { getApprovalConfig, saveApprovalConfig } from "@/server/approval";

type P = { docType: string };

function parseDocType(s: string): ApprovalDocType {
  if (!(s in APPROVAL_DOC_TYPES)) throw new ApiError(404, "ไม่พบชนิดเอกสาร");
  return s as ApprovalDocType;
}

export const GET = apiHandler<P>({ perm: ["settings.approval", "view"] }, async ({ params }) => getApprovalConfig(parseDocType(params.docType)));

/** { steps: [[userId...], ...] } — [] = ไม่มีการตั้งค่าการอนุมัติ */
export const PUT = apiHandler<P>({ perm: ["settings.approval", "edit"] }, async ({ req, user, params, ip }) => {
  const docType = parseDocType(params.docType);
  const d = approvalConfigSchema.parse(await readJson(req));
  await saveApprovalConfig(user, docType, d.steps, ip);
  return getApprovalConfig(docType);
});
