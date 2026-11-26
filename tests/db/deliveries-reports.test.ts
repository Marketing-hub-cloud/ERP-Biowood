// เฟส 9 กับฐานข้อมูลจริง: งานจัดส่ง (สิทธิ์, ยกเลิกตามใบนำออก) + รายงาน (ยอดคงคลัง, stock card, PR/PO ค้าง, ระยะทาง, CSV)
// ข้อมูลมี tag "ZD…" ลบทิ้งตอนจบ
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { adminPermissions, flagsToRow, mergePermissions } from "@/lib/rbac";
import { postIssue, postReceipt } from "@/lib/stock-ledger";
import { UTF8_BOM } from "@/lib/csv";
import { deliveryJobSchema } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import { createDelivery, runDeliveryAction, updateDelivery } from "@/server/deliveries";
import { cancelIssueDoc } from "@/server/goods-issues";
import { findReport, reportCsv } from "@/server/reports";
import type { ReportRow } from "@/lib/reports";

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = `ZD${Date.now().toString(36).toUpperCase()}`;
const todayIso = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const today = new Date(`${todayIso}T00:00:00Z`);

const asUser = (u: { id: string; email: string; firstName: string; lastName: string }, permissions = adminPermissions(), isAdmin = false): CurrentUser => ({
  ...u,
  department: null,
  position: null,
  avatarKey: null,
  isAdmin,
  permissions,
});

let admin: CurrentUser;
let driver: CurrentUser;
let clerk: CurrentUser;
let warehouseId = "";
let productId = "";
let vendorId = "";
let seq = 0;
const jobIds: string[] = [];
const issueIds: string[] = [];
const planIds: string[] = [];

async function expectError(p: Promise<unknown>, status: number) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "ควร error").toBeInstanceOf(ApiError);
  expect((e as ApiError).status).toBe(status);
}

/** ใบนำเข้าที่นำเข้าแล้ว: SN ละจำนวนตาม qtys */
async function postedReceipt(qtys: number[]) {
  const r = await prisma.goodsReceipt.create({ data: { docNo: `${TAG}-GR${++seq}`, docDate: today, warehouseId, createdById: admin.id } });
  const line = await prisma.goodsReceiptLine.create({ data: { receiptId: r.id, lineNo: 1, productId, locationId: warehouseId } });
  await prisma.stockSerial.createMany({
    data: qtys.map((q, i) => ({ barcode: `${r.docNo}-${i + 1}`, seq: i + 1, productId, receiptLineId: line.id, initialQty: q, scannedAt: new Date() })),
  });
  await prisma.$transaction((tx) => postReceipt(tx, r.id, admin.id));
  return prisma.stockSerial.findMany({ where: { receiptLineId: line.id }, orderBy: { seq: "asc" } });
}

async function issue(serialId: string, quantity: number, post = true) {
  const gi = await prisma.goodsIssue.create({
    data: {
      docNo: `${TAG}-GI${++seq}`,
      type: "SALE",
      docDate: today,
      createdById: admin.id,
      shippingAddress: "99 ถนนทดสอบ กรุงเทพมหานคร",
      lines: { create: [{ lineNo: 1, serialId, productId, quantity }] },
    },
  });
  issueIds.push(gi.id);
  if (post) await prisma.$transaction((tx) => postIssue(tx, gi.id, admin.id));
  return gi;
}

const jobInput = (goodsIssueId: string, driverId: string) =>
  deliveryJobSchema.parse({ goodsIssueId, startAt: `${todayIso}T09:00`, endAt: `${todayIso}T11:00`, driverId, mapUrl: "13.7563,100.5018", shippingAddress: "99 ถนนทดสอบ", note: null });

const run = async (module: "crm" | "inventory" | "purchase", key: string, f: Record<string, string>) => findReport(module, key)!.run(f, admin);

describe.skipIf(!hasDb)("งานจัดส่ง + รายงาน (DB)", () => {
  beforeAll(async () => {
    admin = asUser(await prisma.user.findFirstOrThrow({ where: { isAdmin: true } }), adminPermissions(), true);
    const mk = async (k: string, perms: ReturnType<typeof mergePermissions>) =>
      asUser(await prisma.user.create({ data: { email: `${TAG.toLowerCase()}-${k}@test.local`, passwordHash: "x", firstName: k, lastName: TAG } }), perms);
    driver = await mk("driver", mergePermissions([flagsToRow("inventory.delivery", { view: true })]));
    clerk = await mk("clerk", mergePermissions([flagsToRow("inventory.delivery", { view: true, create: true })]));
    warehouseId = (await prisma.stockLocation.create({ data: { level: 0, code: TAG, name: `คลังเทส ${TAG}` } })).id;
    const unit = await prisma.unit.findFirstOrThrow();
    productId = (await prisma.product.create({ data: { code: `${TAG}-P`, name: `สินค้าเทส ${TAG}`, stockUnitId: unit.id } })).id;
    vendorId = (await prisma.contact.create({ data: { code: `${TAG}V`, name: `ผู้ขาย ${TAG}`, isVendor: true } })).id;
  });

  afterAll(async () => {
    if (!productId) return;
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...jobIds, ...issueIds, ...planIds] } } });
    await prisma.deliveryJob.deleteMany({ where: { goodsIssueId: { in: issueIds } } });
    await prisma.workPlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { docNo: { startsWith: TAG } } });
    await prisma.purchaseRequest.deleteMany({ where: { docNo: { startsWith: TAG } } });
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.goodsIssue.deleteMany({ where: { docNo: { startsWith: TAG } } });
    await prisma.stockSerial.deleteMany({ where: { productId } });
    await prisma.goodsReceipt.deleteMany({ where: { docNo: { startsWith: TAG } } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.stockLocation.delete({ where: { id: warehouseId } });
    await prisma.contact.delete({ where: { id: vendorId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
    await prisma.$disconnect();
  });

  it("งานจัดส่ง: สร้าง → แก้ไขต้องมีสิทธิ์แก้ไข → พนักงานส่งของงานกด 'ส่งแล้ว' ได้ คนอื่นไม่ได้ → แก้ไขต่อไม่ได้", async () => {
    const [sn] = await postedReceipt([10]);
    const gi = await issue(sn.id, 2);
    const job = await createDelivery(clerk, jobInput(gi.id, driver.id), null);
    jobIds.push(job.id);
    expect(job.status).toBe("SCHEDULED");
    expect(job.mapUrl).toBe("13.7563,100.5018");

    // clerk ไม่มีสิทธิ์ยกเลิก/แก้ไข และไม่ใช่พนักงานส่ง
    await expectError(runDeliveryAction(clerk, job.id, "deliver", null, null), 403);
    await expectError(runDeliveryAction(clerk, job.id, "cancel", null, null), 403);
    await runDeliveryAction(driver, job.id, "deliver", null, null);
    const after = await prisma.deliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("DELIVERED");
    expect(after.deliveredAt).not.toBeNull();
    await expectError(runDeliveryAction(admin, job.id, "cancel", null, null), 409);
    await expectError(updateDelivery(admin, job.id, jobInput(gi.id, driver.id), null), 409);

    const logs = await prisma.auditLog.findMany({ where: { entityType: "DeliveryJob", entityId: job.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["CREATE", "STATUS_CHANGE"]);
  });

  it("ยกเลิกใบนำออก → งานจัดส่งที่ยังนัดส่งถูกยกเลิกตาม; สร้างงานให้ใบนำออกที่ยกเลิกแล้วไม่ได้", async () => {
    const [sn] = await postedReceipt([5]);
    const gi = await issue(sn.id, 1, false);
    const job = await createDelivery(admin, jobInput(gi.id, driver.id), null);
    jobIds.push(job.id);
    await cancelIssueDoc(admin, gi.id, "ลูกค้ายกเลิก", null);
    const j = await prisma.deliveryJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(j.status).toBe("CANCELLED");
    expect(j.cancelReason).toContain(gi.docNo);
    await expectError(createDelivery(admin, jobInput(gi.id, driver.id), null), 400);
  });

  it("validator: ลิงก์/พิกัดแผนที่ และวันสิ้นสุดต้องไม่ก่อนวันเริ่ม", () => {
    const base = { goodsIssueId: "x", startAt: `${todayIso}T09:00`, endAt: `${todayIso}T10:00`, driverId: "u" };
    expect(deliveryJobSchema.safeParse({ ...base, mapUrl: "https://maps.app.goo.gl/abc" }).success).toBe(true);
    expect(deliveryJobSchema.safeParse({ ...base, mapUrl: "ไม่ใช่ลิงก์" }).success).toBe(false);
    expect(deliveryJobSchema.safeParse({ ...base, mapUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(deliveryJobSchema.safeParse({ ...base, endAt: `${todayIso}T08:00` }).success).toBe(false);
  });

  it("รายงานคลัง: ยอดคงคลัง ณ วันนี้, stock card ยอดสะสม, SN คงเหลือ — ตรงกับ movement", async () => {
    const [a, b] = await postedReceipt([10, 6]);
    await issue(a.id, 4);
    const onHand = await run("inventory", "on-hand", { asOf: todayIso, warehouse: warehouseId, view: "product" });
    const mine = onHand.rows.find((r) => r.code === `${TAG}-P`)!;
    // ทุกการทดสอบในไฟล์ใช้สินค้าเดียวกัน → เทียบกับผลรวม movement จริง
    const total = Number((await prisma.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity);
    expect(mine.qty).toBe(total);
    // ณ เมื่อวาน ยังไม่มีสต๊อก
    const yesterday = new Date(today.getTime() - 86400_000).toISOString().slice(0, 10);
    expect((await run("inventory", "on-hand", { asOf: yesterday, warehouse: warehouseId })).rows).toHaveLength(0);

    const card = await run("inventory", "stock-card", { from: todayIso, to: todayIso, product: productId });
    const body = card.rows.filter((r) => r.type !== "ยอดยกมา" && r.type !== "ยอดคงเหลือ");
    let bal = 0;
    for (const r of body) {
      bal += Number(r.in ?? 0) - Number(r.out ?? 0);
      expect(r.balance).toBeCloseTo(bal, 3);
    }
    expect(card.rows.at(-1)).toMatchObject({ type: "ยอดคงเหลือ", balance: total });

    const sns = await run("inventory", "serials", { product: productId, balance: "remaining" });
    expect(sns.rows.find((r) => r.barcode === a.barcode)).toMatchObject({ initialQty: 10, balance: 6 });
    expect(sns.rows.find((r) => r.barcode === b.barcode)).toMatchObject({ initialQty: 6, balance: 6 });
  });

  it("รายงานจัดซื้อ: PR 10 → PO 6 (อนุมัติ) → PR ค้างสั่งซื้อ 4, PO ค้างรับ 6, ยอดซื้อตามผู้ขาย", async () => {
    const pr = await prisma.purchaseRequest.create({
      data: { docNo: `${TAG}-PR`, status: "APPROVED", docDate: today, requesterId: admin.id, createdById: admin.id, lines: { create: [{ lineNo: 1, productId, quantity: 10 }] } },
      include: { lines: true },
    });
    await prisma.purchaseOrder.create({
      data: {
        docNo: `${TAG}-PO`,
        status: "APPROVED",
        docDate: today,
        vendorId,
        createdById: admin.id,
        subtotal: 600,
        vatAmount: 42,
        total: 642,
        lines: { create: [{ lineNo: 1, productId, requestLineId: pr.lines[0].id, quantity: 6, unitPrice: 100, amount: 600 }] },
      },
    });
    const prOpen = await run("purchase", "pr-open", {});
    expect(prOpen.rows.find((r) => r.docNo === pr.docNo)).toMatchObject({ qty: 10, ordered: 6, remaining: 4 });
    const poOpen = await run("purchase", "po-open", { vendor: vendorId });
    expect(poOpen.rows).toHaveLength(1);
    expect(poOpen.rows[0]).toMatchObject({ qty: 6, received: 0, remaining: 6, remainingAmount: 600 });
    const byVendor = await run("purchase", "by-vendor", { from: todayIso, to: todayIso });
    expect(byVendor.rows.find((r) => r.code === `${TAG}V`)).toMatchObject({ count: 1, subtotal: 600, vat: 42, total: 642 });
  });

  it("รายงานตารางทำงานและระยะทาง: สรุปต่อพนักงานรวมระยะทางถูกต้อง", async () => {
    const at = (h: number) => new Date(`${todayIso}T${String(h).padStart(2, "0")}:00:00+07:00`);
    for (const [h, km, status] of [
      [9, 12.5, "DONE"],
      [13, 7.25, "DONE"],
      [15, null, "CANCELLED"],
    ] as const) {
      const p = await prisma.workPlan.create({
        data: { subject: `${TAG} แผน ${h}`, status, plannedStart: at(h), plannedEnd: at(h + 1), employeeId: driver.id, createdById: admin.id, distanceKm: km },
      });
      planIds.push(p.id);
    }
    const sum = await run("crm", "work-plans", { from: todayIso, to: todayIso, employee: driver.id, view: "summary" });
    expect(sum.rows).toHaveLength(1);
    expect(sum.rows[0]).toMatchObject({ total: 3, done: 2, cancelled: 1, measured: 2, distanceKm: 19.75 });
    const detail = await run("crm", "work-plans", { from: todayIso, to: todayIso, employee: driver.id, view: "detail" });
    expect(detail.rows).toHaveLength(3);
    expect(detail.totals?.distanceKm).toBe(19.75);

    // CSV: UTF-8 BOM + หัวตารางภาษาไทย + ตัวเลขดิบ + แถวรวม
    const csv = reportCsv(sum);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toContain("ระยะทางรวม (กม.)");
    expect(csv.trim().split("\r\n").at(-1)).toContain("19.75");
  });

  it("ทุกรายงานรันได้ด้วยตัวกรองว่าง และคอลัมน์ครบทุกแถว", async () => {
    const { REPORTS } = await import("@/server/reports");
    for (const mod of ["crm", "inventory", "purchase"] as const) {
      for (const r of REPORTS[mod]) {
        const filters = await r.filters();
        expect(filters.length, r.key).toBeGreaterThan(0);
        const res = await r.run({ from: todayIso, to: todayIso }, admin);
        const keys = res.columns.map((c) => c.key);
        for (const row of res.rows.slice(0, 20) as ReportRow[]) for (const k of keys) expect(k in row, `${r.key}.${k}`).toBe(true);
      }
    }
  });
});
