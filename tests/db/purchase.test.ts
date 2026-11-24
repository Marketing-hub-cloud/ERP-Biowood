// เทสระบบจัดซื้อกับฐานข้อมูลจริง (เรียก logic ฝั่ง server โดยตรง)
// PR → PO (ห้ามเกินคงค้าง แม้สร้างพร้อมกัน) → อนุมัติหลายลำดับ → นำเข้า → ส่งคืน → นำออกส่งคืน
// ข้อมูลที่สร้างมี tag "ZT…" และลบทิ้งตอนจบ; ผังอนุมัติ PR ที่มีอยู่จะถูกเก็บแล้วคืนค่า
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { adminPermissions, flagsToRow, mergePermissions } from "@/lib/rbac";
import { postReceipt, serialBalances } from "@/lib/stock-ledger";
import { purchaseOrderSchema, purchaseRequestSchema, purchaseReturnSchema, issueSchema } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import { createRequest, requestApproval } from "@/server/purchase-requests";
import { createOrder, orderApproval, cancelOrder } from "@/server/purchase-orders";
import { createReturn, returnApproval } from "@/server/purchase-returns";
import { createIssue } from "@/server/goods-issues";
import { saveApprovalConfig } from "@/server/approval";

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = `ZT${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);

let admin: CurrentUser;
const people: Record<"A" | "B" | "C" | "X", CurrentUser> = {} as never;
let productId = "";
let vendorId = "";
let warehouseId = "";
let savedPrConfig: string[][] = [];

const asUser = (u: { id: string; email: string; firstName: string; lastName: string }, permissions = adminPermissions(), isAdmin = false): CurrentUser => ({
  ...u,
  department: null,
  position: null,
  avatarKey: null,
  isAdmin,
  permissions,
});

async function approvedRequest(qty: number) {
  const pr = await createRequest(admin, purchaseRequestSchema.parse({ docDate: today, requesterId: admin.id, lines: [{ productId, quantity: qty }] }), null);
  await requestApproval(admin, pr.id, "submit", null, null);
  await requestApproval(admin, pr.id, "approve", null, null);
  return prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id }, include: { lines: true } });
}

const orderInput = (requestLineId: string | null, quantity: number, unitPrice = 100) =>
  purchaseOrderSchema.parse({ docDate: today, vendorId, warehouseId, lines: [{ productId, requestLineId, quantity, unitPrice }] });

const prStatus = async (id: string) => (await prisma.purchaseRequest.findUniqueOrThrow({ where: { id } })).status;
const poStatus = async (id: string) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;

describe.skipIf(!hasDb)("จัดซื้อ (DB)", () => {
  beforeAll(async () => {
    const a = await prisma.user.findFirstOrThrow({ where: { isAdmin: true } });
    admin = asUser(a, adminPermissions(), true);
    // ผู้ใช้ทดสอบ: ดู/แก้ใบขอซื้อได้ แต่ไม่มีสิทธิ์ "อนุมัติ" (อนุมัติได้เพราะอยู่ในผังเท่านั้น)
    const perms = mergePermissions([flagsToRow("purchase.request", { view: true, create: true, edit: true })]);
    for (const k of ["A", "B", "C", "X"] as const) {
      const u = await prisma.user.create({ data: { email: `${TAG.toLowerCase()}-${k.toLowerCase()}@test.local`, passwordHash: "x", firstName: k, lastName: TAG } });
      people[k] = asUser(u, perms);
    }
    const unit = await prisma.unit.findFirstOrThrow();
    productId = (await prisma.product.create({ data: { code: `${TAG}-P`, name: `สินค้า ${TAG}`, stockUnitId: unit.id } })).id;
    vendorId = (await prisma.contact.create({ data: { code: `${TAG}-V`, name: `ผู้ขาย ${TAG}`, isVendor: true } })).id;
    warehouseId = (await prisma.stockLocation.create({ data: { level: 0, code: TAG, name: `คลัง ${TAG}` } })).id;
    const cfg = await prisma.approvalStep.findMany({ where: { docType: "PR" }, orderBy: { stepNo: "asc" }, include: { approvers: true } });
    savedPrConfig = cfg.map((s) => s.approvers.map((x) => x.userId));
    await saveApprovalConfig(admin, "PR", [], null);
  });

  afterAll(async () => {
    if (!productId) return;
    await saveApprovalConfig(admin, "PR", savedPrConfig, null).catch(() => undefined);
    const prs = await prisma.purchaseRequest.findMany({ where: { lines: { some: { productId } } }, select: { id: true } });
    const pos = await prisma.purchaseOrder.findMany({ where: { vendorId }, select: { id: true } });
    const rts = await prisma.purchaseReturn.findMany({ where: { vendorId }, select: { id: true } });
    const docIds = [...prs, ...pos, ...rts].map((d) => d.id);
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.goodsIssue.deleteMany({ where: { OR: [{ purchaseReturnId: { in: rts.map((r) => r.id) } }, { contactId: vendorId }] } });
    await prisma.stockSerial.deleteMany({ where: { productId } });
    await prisma.goodsReceipt.deleteMany({ where: { warehouseId } });
    await prisma.purchaseReturn.deleteMany({ where: { vendorId } });
    await prisma.purchaseOrder.deleteMany({ where: { vendorId } });
    await prisma.purchaseRequest.deleteMany({ where: { id: { in: prs.map((p) => p.id) } } });
    await prisma.approvalAction.deleteMany({ where: { docId: { in: docIds } } });
    // แจ้งเตือน/คิว LINE ของเอกสารทดสอบ (เฟส 6) — ไม่ลบจะเหลือแจ้งเตือนที่ลิงก์ไปเอกสารที่ไม่มีแล้ว
    await prisma.notification.deleteMany({ where: { docId: { in: docIds } } });
    await prisma.notificationDelivery.deleteMany({ where: { refId: { in: docIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...docIds, productId, vendorId] } }, { entityType: "ApprovalSetting", createdAt: { gte: new Date(Date.now() - 3600_000) }, note: null }] } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.contact.delete({ where: { id: vendorId } });
    await prisma.stockLocation.delete({ where: { id: warehouseId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
    await prisma.$disconnect();
  });

  it("PR 10 → PO 6 = สั่งซื้อแล้วบางส่วน → PO 4 = สั่งซื้อแล้ว; เกินคงค้างไม่ได้", async () => {
    const pr = await approvedRequest(10);
    expect(pr.status).toBe("APPROVED");
    const line = pr.lines[0].id;
    await createOrder(admin, orderInput(line, 6), null);
    expect(await prStatus(pr.id)).toBe("PARTIAL");
    await expect(createOrder(admin, orderInput(line, 5), null)).rejects.toThrow(/เกินจำนวนคงค้าง.*คงค้าง 4/);
    const po2 = await createOrder(admin, orderInput(line, 4), null);
    expect(await prStatus(pr.id)).toBe("COMPLETED");
    // ยกเลิก PO ใบที่ 2 → PR กลับเป็นบางส่วน
    await cancelOrder(admin, po2.id, "ทดสอบ", null);
    expect(await prStatus(pr.id)).toBe("PARTIAL");
  });

  it("สร้าง PO จาก PR เดียวกันพร้อมกัน (6 + 6 จาก 10) สำเร็จใบเดียว", async () => {
    const pr = await approvedRequest(10);
    const line = pr.lines[0].id;
    const results = await Promise.allSettled([createOrder(admin, orderInput(line, 6), null), createOrder(admin, orderInput(line, 6), null)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/เกินจำนวนคงค้าง/);
  });

  it("อนุมัติ 2 ลำดับ: ลำดับ 1 = A,B แค่ A กดก็ไปลำดับ 2 (C); คนนอกลำดับ 403; ไม่อนุมัติกลับเป็นร่าง", async () => {
    await saveApprovalConfig(admin, "PR", [[people.A.id, people.B.id], [people.C.id]], null);
    const pr = await createRequest(admin, purchaseRequestSchema.parse({ docDate: today, requesterId: admin.id, lines: [{ productId, quantity: 1 }] }), null);
    await requestApproval(people.X, pr.id, "submit", null, null);
    // admin มีสิทธิ์อนุมัติแต่ไม่อยู่ในผัง → กดไม่ได้
    await expect(requestApproval(admin, pr.id, "approve", null, null)).rejects.toMatchObject({ status: 403 });
    await expect(requestApproval(people.C, pr.id, "approve", null, null)).rejects.toMatchObject({ status: 403 });
    await requestApproval(people.A, pr.id, "approve", "ok", null);
    let d = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } });
    expect(d).toMatchObject({ status: "PENDING", currentStep: 2 });
    await expect(requestApproval(people.B, pr.id, "approve", null, null)).rejects.toMatchObject({ status: 403 });
    // ไม่อนุมัติต้องมีเหตุผล
    await expect(requestApproval(people.C, pr.id, "reject", null, null)).rejects.toThrow(/เหตุผล/);
    await requestApproval(people.C, pr.id, "reject", "ราคาสูงไป", null);
    d = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } });
    expect(d).toMatchObject({ status: "DRAFT", currentStep: null, approvalRound: 1 });
    // ส่งใหม่ → รอบ 2 เริ่มลำดับ 1 → B กด → C กด = อนุมัติแล้ว
    await requestApproval(people.X, pr.id, "submit", null, null);
    await requestApproval(people.B, pr.id, "approve", null, null);
    await requestApproval(people.C, pr.id, "approve", null, null);
    d = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } });
    expect(d).toMatchObject({ status: "APPROVED", currentStep: null, approvalRound: 2 });
    const hist = await prisma.approvalAction.findMany({ where: { docId: pr.id }, orderBy: { createdAt: "asc" } });
    expect(hist.map((h) => `${h.round}:${h.action}:${h.stepNo ?? "-"}`)).toEqual(["1:SUBMIT:-", "1:APPROVE:1", "1:REJECT:2", "2:SUBMIT:-", "2:APPROVE:1", "2:APPROVE:2"]);
    await saveApprovalConfig(admin, "PR", [], null);
  });

  it("PO 10 → นำเข้า 4 = นำเข้าแล้วบางส่วน ยอด +4; รับเกินไม่ได้ → ส่งคืน 2 → นำออกส่งคืน → ยอดลด", async () => {
    const po = await createOrder(admin, orderInput(null, 10, 1250), null);
    expect(Number(po.total)).toBe(13375); // 12,500 + VAT 875
    await orderApproval(admin, po.id, "submit", null, null);
    await orderApproval(admin, po.id, "approve", null, null);
    const ol = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { orderId: po.id } });

    const receive = async (qty: number) =>
      prisma.$transaction(async (tx) => {
        const r = await tx.goodsReceipt.create({
          data: {
            docNo: `${TAG}-GR${qty}${Math.random().toString(36).slice(2, 5)}`,
            type: "PURCHASE",
            purchaseOrderId: po.id,
            docDate: new Date(`${today}T00:00:00Z`),
            warehouseId,
            createdById: admin.id,
          },
        });
        const line = await tx.goodsReceiptLine.create({ data: { receiptId: r.id, lineNo: 1, productId, orderLineId: ol.id, locationId: warehouseId } });
        await tx.stockSerial.create({ data: { barcode: `${r.docNo}-001`, seq: 1, productId, receiptLineId: line.id, initialQty: qty, scannedAt: new Date() } });
        await postReceipt(tx, r.id, admin.id);
        return r;
      });

    await receive(4);
    expect(await poStatus(po.id)).toBe("PARTIAL");
    await expect(receive(7)).rejects.toThrow(/เกินจำนวนคงค้างของใบสั่งซื้อ \(คงค้าง 6\)/);

    // ส่งคืนเกินที่รับมาไม่ได้
    const reason = await prisma.lookupOption.upsert({
      where: { kind_label: { kind: "RETURN_REASON", label: "สินค้าชำรุด" } },
      update: {},
      create: { kind: "RETURN_REASON", label: "สินค้าชำรุด" },
    });
    const rtInput = (q: number) => purchaseReturnSchema.parse({ docDate: today, orderId: po.id, reasonId: reason.id, lines: [{ orderLineId: ol.id, quantity: q }] });
    await expect(createReturn(admin, rtInput(5), null)).rejects.toThrow(/เกินจำนวนที่คืนได้ \(คืนได้ 4\)/);
    const rt = await createReturn(admin, rtInput(2), null);
    await returnApproval(admin, rt.id, "submit", null, null);
    await returnApproval(admin, rt.id, "approve", null, null);

    // นำออกประเภทส่งคืน: สแกน SN แล้วคืน 3 ไม่ได้ (คืนได้ 2) → คืน 2 ได้
    const serial = await prisma.stockSerial.findFirstOrThrow({ where: { productId, receiptLine: { receipt: { status: "POSTED" } } } });
    const giInput = (q: number) => issueSchema.parse({ type: "RETURN", docDate: today, purchaseReturnId: rt.id, lines: [{ serialId: serial.id, quantity: q }] });
    await expect(createIssue(admin, giInput(3), true, null)).rejects.toThrow(/เกินจำนวนที่ต้องส่งคืน/);
    const gi = await createIssue(admin, giInput(2), true, null);
    const giDoc = await prisma.goodsIssue.findUniqueOrThrow({ where: { id: gi.id } });
    expect(giDoc).toMatchObject({ status: "POSTED", contactId: vendorId });
    expect((await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: rt.id } })).status).toBe("COMPLETED");
    expect((await prisma.$transaction((tx) => serialBalances(tx, [serial.id]))).get(serial.id)).toBe(2);
    // PO ยังเป็นบางส่วน (การคืนไม่ลด "นำเข้าแล้ว")
    expect(await poStatus(po.id)).toBe("PARTIAL");
    // ยกเลิก PO ไม่ได้เพราะมีใบนำเข้า/ใบส่งคืน
    await expect(cancelOrder(admin, po.id, "x", null)).rejects.toThrow(/มีเอกสารอ้างอิงอยู่/);
  }, 120_000);
});
