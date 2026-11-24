// แจ้งเตือนกับฐานข้อมูลจริง: ผู้รับแจ้งเตือนในระบบ, คิว LINE ใน transaction เดียวกับเอกสาร, worker ไม่ส่งซ้ำ + retry
// ข้อมูลมี tag "ZT…" ลบทิ้งตอนจบ; ผังอนุมัติ PR และตั้งค่าแจ้งเตือนจัดซื้อเดิมถูกเก็บแล้วคืนค่า
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { adminPermissions, flagsToRow, mergePermissions } from "@/lib/rbac";
import { purchaseRequestSchema } from "@/lib/validators";
import { processDueDeliveries } from "@/lib/notification-worker";
import type { CurrentUser } from "@/lib/session";
import { createRequest, requestApproval, cancelRequest } from "@/server/purchase-requests";
import { saveApprovalConfig } from "@/server/approval";

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = `ZT${Date.now().toString(36).toUpperCase()}`;
const GROUP = `C${TAG.toLowerCase()}0000000000`;
const today = new Date().toISOString().slice(0, 10);

let admin: CurrentUser;
const people: Record<"A" | "B" | "C" | "R", CurrentUser> = {} as never;
let productId = "";
let savedConfig: string[][] = [];
let savedSetting: { lineEnabled: boolean; lineGroupId: string | null; lineGroupName: string | null } | null = null;
const docIds: string[] = [];

const asUser = (u: { id: string; email: string; firstName: string; lastName: string }, permissions = adminPermissions(), isAdmin = false): CurrentUser => ({
  ...u,
  department: null,
  position: null,
  avatarKey: null,
  isAdmin,
  permissions,
});
const inbox = (userId: string, docId: string) => prisma.notification.findMany({ where: { userId, docId }, orderBy: { createdAt: "asc" } });

describe.skipIf(!hasDb)("แจ้งเตือน (DB)", () => {
  beforeAll(async () => {
    admin = asUser(await prisma.user.findFirstOrThrow({ where: { isAdmin: true } }), adminPermissions(), true);
    const perms = mergePermissions([flagsToRow("purchase.request", { view: true, create: true, edit: true })]);
    for (const k of ["A", "B", "C", "R"] as const) {
      const u = await prisma.user.create({ data: { email: `${TAG.toLowerCase()}-${k.toLowerCase()}@test.local`, passwordHash: "x", firstName: k, lastName: TAG } });
      people[k] = asUser(u, perms);
    }
    const unit = await prisma.unit.findFirstOrThrow();
    productId = (await prisma.product.create({ data: { code: `${TAG}-P`, name: `สินค้า ${TAG}`, stockUnitId: unit.id } })).id;
    const cfg = await prisma.approvalStep.findMany({ where: { docType: "PR" }, orderBy: { stepNo: "asc" }, include: { approvers: true } });
    savedConfig = cfg.map((s) => s.approvers.map((x) => x.userId));
    savedSetting = await prisma.notificationSetting.findUnique({ where: { module: "purchase" } });
    await saveApprovalConfig(admin, "PR", [[people.A.id, people.B.id], [people.C.id]], null);
    await prisma.notificationSetting.upsert({
      where: { module: "purchase" },
      create: { module: "purchase", lineEnabled: true, lineGroupId: GROUP },
      update: { lineEnabled: true, lineGroupId: GROUP, lineGroupName: null },
    });
  });

  afterAll(async () => {
    if (!productId) return;
    await saveApprovalConfig(admin, "PR", savedConfig, null).catch(() => undefined);
    if (savedSetting) await prisma.notificationSetting.update({ where: { module: "purchase" }, data: savedSetting });
    else await prisma.notificationSetting.deleteMany({ where: { module: "purchase" } });
    await prisma.notificationDelivery.deleteMany({ where: { OR: [{ target: GROUP }, { refId: { in: docIds } }] } });
    await prisma.notification.deleteMany({ where: { docId: { in: docIds } } });
    await prisma.approvalAction.deleteMany({ where: { docId: { in: docIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...docIds, productId] } } });
    await prisma.purchaseRequest.deleteMany({ where: { id: { in: docIds } } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("ผู้รับ: ส่ง → ผู้อนุมัติลำดับ 1 (ไม่รวมผู้กด) → อนุมัติ → ลำดับ 2 → ไม่อนุมัติ → เจ้าของ/ผู้ขอ", async () => {
    // A สร้าง โดยผู้ขอคือ R → A ส่งเอง (A อยู่ในลำดับ 1 แต่เป็นผู้กด จึงไม่ได้แจ้งเตือน)
    const pr = await createRequest(people.A, purchaseRequestSchema.parse({ docDate: today, requesterId: people.R.id, lines: [{ productId, quantity: 1 }] }), null);
    docIds.push(pr.id);
    await requestApproval(people.A, pr.id, "submit", null, null);
    expect(await inbox(people.A.id, pr.id)).toHaveLength(0);
    const b1 = await inbox(people.B.id, pr.id);
    expect(b1.map((n) => n.title)).toEqual([`ใบขอซื้อ ${pr.docNo} รออนุมัติจากคุณ`]);
    expect(b1[0].link).toBe(`/purchase/requests/${pr.id}`);
    expect(await inbox(people.C.id, pr.id)).toHaveLength(0);

    await requestApproval(people.B, pr.id, "approve", null, null);
    expect((await inbox(people.C.id, pr.id)).map((n) => n.body)).toEqual(["ลำดับ 2 · อนุมัติลำดับ 1 แล้ว โดย B " + TAG]);

    await requestApproval(people.C, pr.id, "reject", "แก้จำนวน", null);
    // เจ้าของ (A ผู้สร้าง) และผู้ขอ (R) ได้แจ้งเตือนไม่อนุมัติ
    for (const u of [people.A, people.R]) {
      const titles = (await inbox(u.id, pr.id)).map((n) => n.title);
      expect(titles).toContain(`ใบขอซื้อ ${pr.docNo} ไม่อนุมัติ`);
    }

    // คิว LINE: สร้าง + ส่ง + อนุมัติลำดับ 1 + ไม่อนุมัติ = 4 ข้อความ เรียงตามเวลา
    const q = await prisma.notificationDelivery.findMany({ where: { refId: pr.id }, orderBy: { createdAt: "asc" } });
    expect(q.map((d) => d.message.split("\n")[0])).toEqual([
      `[จัดซื้อ] สร้างเอกสาร ใบขอซื้อ ${pr.docNo}`,
      `[จัดซื้อ] ส่งอนุมัติ ใบขอซื้อ ${pr.docNo}`,
      `[จัดซื้อ] อนุมัติลำดับ 1 ใบขอซื้อ ${pr.docNo}`,
      `[จัดซื้อ] ไม่อนุมัติ ใบขอซื้อ ${pr.docNo}`,
    ]);
    expect(q.every((d) => d.target === GROUP && d.status === "PENDING")).toBe(true);
  });

  it("เอกสารบันทึกไม่สำเร็จ = ไม่มีแจ้งเตือน/คิวค้าง (อยู่ใน transaction เดียวกัน)", async () => {
    const before = await prisma.notificationDelivery.count({ where: { target: GROUP } });
    // ผู้ขอไม่มีอยู่จริง → createRequest ล้ม
    await expect(createRequest(admin, purchaseRequestSchema.parse({ docDate: today, requesterId: "nope", lines: [{ productId, quantity: 1 }] }), null)).rejects.toThrow();
    expect(await prisma.notificationDelivery.count({ where: { target: GROUP } })).toBe(before);
  });

  it("ปิด LINE ของโมดูล = ไม่เข้าคิว แต่แจ้งเตือนในระบบยังมี", async () => {
    await prisma.notificationSetting.update({ where: { module: "purchase" }, data: { lineEnabled: false } });
    const pr = await createRequest(people.A, purchaseRequestSchema.parse({ docDate: today, requesterId: people.R.id, lines: [{ productId, quantity: 1 }] }), null);
    docIds.push(pr.id);
    await cancelRequest(admin, pr.id, "ไม่ใช้แล้ว", null);
    expect(await prisma.notificationDelivery.count({ where: { refId: pr.id } })).toBe(0);
    expect((await inbox(people.A.id, pr.id)).map((n) => n.title)).toEqual([`ใบขอซื้อ ${pr.docNo} ถูกยกเลิก`]);
    await prisma.notificationSetting.update({ where: { module: "purchase" }, data: { lineEnabled: true } });
  });

  it("worker: 2 ตัวพร้อมกันไม่ส่งซ้ำ; 500 = ลองใหม่ใน 1 นาที; 400 = ส่งไม่สำเร็จทันที; ไม่มี token = ไม่แตะคิว", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "");
    expect((await processDueDeliveries()).skipped).toBe("no-token");

    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "test-token");
    vi.stubEnv("LINE_API_BASE", "https://line.test");
    const calls: string[] = [];
    const ok = vi.fn(async (_u: string, init: RequestInit) => {
      calls.push((init.headers as Record<string, string>)["X-Line-Retry-Key"]);
      await new Promise((r) => setTimeout(r, 30));
      return new Response("{}", { status: 200 });
    });
    const due = await prisma.notificationDelivery.count({ where: { target: GROUP, status: "PENDING" } });
    expect(due).toBeGreaterThanOrEqual(4);
    const [r1, r2] = await Promise.all([
      processDueDeliveries({ fetchImpl: ok as unknown as typeof fetch }),
      processDueDeliveries({ fetchImpl: ok as unknown as typeof fetch }),
    ]);
    expect(r1.sent + r2.sent).toBe(due);
    expect(new Set(calls).size).toBe(calls.length); // ไม่มีรายการไหนถูกส่ง 2 ครั้ง
    expect(await prisma.notificationDelivery.count({ where: { target: GROUP, status: "SENT" } })).toBe(due);

    // ล้มชั่วคราว
    const a = await prisma.notificationDelivery.create({ data: { module: "purchase", target: GROUP, message: "x" } });
    const t0 = Date.now();
    await processDueDeliveries({ fetchImpl: (async () => new Response("down", { status: 503 })) as unknown as typeof fetch });
    const a1 = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: a.id } });
    expect(a1).toMatchObject({ status: "PENDING", attempts: 1, lastError: "LINE 503: down" });
    expect(a1.nextAttemptAt.getTime() - t0).toBeGreaterThanOrEqual(55_000);
    // ยังไม่ถึงเวลา → รอบถัดไปไม่แตะ
    expect((await processDueDeliveries({ fetchImpl: ok as unknown as typeof fetch })).sent).toBe(0);

    // ผิดถาวร (groupId ผิด)
    const b = await prisma.notificationDelivery.create({ data: { module: "purchase", target: GROUP, message: "y" } });
    await processDueDeliveries({ fetchImpl: (async () => new Response("bad to", { status: 400 })) as unknown as typeof fetch });
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ status: "FAILED", attempts: 1, lastError: "LINE 400: bad to" });
    vi.unstubAllEnvs();
  });
});
