import "server-only";
import { ApiError } from "@/lib/errors";
import { can } from "@/lib/rbac";
import { APPROVAL_DOC_TYPES, type ApprovalDocType } from "@/lib/approval";
import { approvalActionSchema } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import { cancelRequest, requestApproval } from "./purchase-requests";
import { cancelOrder, orderApproval } from "./purchase-orders";
import { cancelReturn, returnApproval } from "./purchase-returns";

const APPROVAL = { PR: requestApproval, PO: orderApproval, RT: returnApproval };
const CANCEL = { PR: cancelRequest, PO: cancelOrder, RT: cancelReturn };

/**
 * ปุ่มสถานะของเอกสารจัดซื้อ: { action: submit | approve | reject | cancel, comment }
 * สิทธิ์ตรวจละเอียดใน runApproval (ส่ง = แก้ไข, อนุมัติ = อยู่ในลำดับปัจจุบัน) และที่นี่สำหรับยกเลิก
 */
export async function handlePurchaseAction(docType: ApprovalDocType, user: CurrentUser, id: string, body: unknown, ip: string | null) {
  const d = approvalActionSchema.parse(body);
  const menuKey = APPROVAL_DOC_TYPES[docType].menuKey;
  if (!can(user.permissions, menuKey, "view")) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  const comment = d.comment?.trim() || null;
  if (d.action === "cancel") {
    if (!can(user.permissions, menuKey, "cancel")) throw new ApiError(403, "ไม่มีสิทธิ์ยกเลิกเอกสาร");
    if (!comment) throw new ApiError(400, "กรุณากรอกเหตุผลการยกเลิก", { comment: "กรุณากรอกเหตุผล" });
    await CANCEL[docType](user, id, comment, ip);
    return { ok: true, status: "CANCELLED" };
  }
  return APPROVAL[docType](user, id, d.action, comment, ip);
}
