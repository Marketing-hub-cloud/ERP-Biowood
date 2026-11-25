import { ApiError, apiHandler } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { fullName } from "@/lib/format";
import { canOnContact } from "@/lib/contact-rules";
import { ENTITY_CONTACT } from "@/server/contacts";

/** entityType -> menuKey ที่ต้องมีสิทธิ์ view จึงดูประวัติได้ (เพิ่มเมื่อมีเอกสารใหม่) */
const ENTITY_MENU: Record<string, string> = {
  User: "users.account",
  PermissionGroup: "users.group",
  CompanySetting: "settings.company",
  StockLocation: "settings.inventory",
  ProductCategory: "settings.inventory",
  Unit: "settings.inventory",
  ProductAttribute: "settings.inventory",
  Product: "inventory.product",
  GoodsReceipt: "inventory.receipt",
  GoodsIssue: "inventory.issue",
  PurchaseRequest: "purchase.request",
  PurchaseOrder: "purchase.order",
  PurchaseReturn: "purchase.return",
  EngineerDoc: "engineer.document",
  ApprovalSetting: "settings.approval",
  NoteTemplate: "settings.remark",
  NotificationSetting: "settings.notification",
  // Contact: ตรวจตามบทบาทด้านล่าง
};

export type AuditEntry = {
  id: string;
  action: string;
  actorName: string | null;
  changes: Record<string, [unknown, unknown]> | null;
  after: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  note: string | null;
  createdAt: string;
};

export const GET = apiHandler({}, async ({ req, user }) => {
  const entityType = req.nextUrl.searchParams.get("entityType") ?? "";
  const entityId = req.nextUrl.searchParams.get("entityId") ?? "";
  if (!entityId) throw new ApiError(400, "พารามิเตอร์ไม่ถูกต้อง");
  if (entityType === ENTITY_CONTACT) {
    // ผู้ติดต่อ: สิทธิ์ตามบทบาท (ลูกค้า/ผู้ขาย) — ดูได้แม้ถูกลบไปแล้ว
    const c = await prisma.contact.findUnique({ where: { id: entityId }, select: { isCustomer: true, isVendor: true } });
    if (!c) throw new ApiError(404, "ไม่พบข้อมูล");
    if (!canOnContact(user.permissions, c, "view")) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  } else {
    const menuKey = ENTITY_MENU[entityType];
    if (!menuKey) throw new ApiError(400, "พารามิเตอร์ไม่ถูกต้อง");
    // ผู้ใช้ดูประวัติของบัญชีตัวเองได้เสมอ
    const own = entityType === "User" && entityId === user.id;
    if (!own && !can(user.permissions, menuKey, "view")) throw new ApiError(403, "ไม่มีสิทธิ์ใช้งาน");
  }

  const logs = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { firstName: true, lastName: true } } },
  });
  return logs.map(
    (l): AuditEntry => ({
      id: l.id,
      action: l.action,
      actorName: l.actor ? fullName(l.actor) : null,
      changes: l.changes as AuditEntry["changes"],
      after: l.after as AuditEntry["after"],
      before: l.before as AuditEntry["before"],
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    }),
  );
});
