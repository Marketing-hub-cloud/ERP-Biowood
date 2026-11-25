// CRM กับฐานข้อมูลจริง: โครงการ (เปลี่ยนสถานะ = การเคลื่อนไหว, ลบไม่ได้ถ้ามีเอกสารอ้างอิง), แผนการทำงาน (เช็คอิน + ระยะทาง)
// ข้อมูลมี tag "ZC…" ลบทิ้งตอนจบ
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { adminPermissions, flagsToRow, mergePermissions } from "@/lib/rbac";
import { haversineKm } from "@/lib/distance";
import { engineerDocSchema, projectSchema, workPlanSchema } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import { createProject, deleteProject, updateProject } from "@/server/projects";
import { createPlan, runPlanAction, updatePlan } from "@/server/work-plans";
import { cancelEngineerDoc, createEngineerDoc } from "@/server/engineer-docs";

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = `ZC${Date.now().toString(36).toUpperCase()}`;
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const asUser = (u: { id: string; email: string; firstName: string; lastName: string }, permissions = adminPermissions(), isAdmin = false): CurrentUser => ({
  ...u,
  department: null,
  position: null,
  avatarKey: null,
  isAdmin,
  permissions,
});

let admin: CurrentUser;
let sales: CurrentUser;
let other: CurrentUser;
let customerId = "";
const projectIds: string[] = [];
const planIds: string[] = [];
const enIds: string[] = [];

async function expectError(p: Promise<unknown>, status: number) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "ควร error").toBeInstanceOf(ApiError);
  expect((e as ApiError).status).toBe(status);
}

const A = { lat: 13.7563, lng: 100.5018 };
const B = { lat: 13.8199, lng: 100.5603 };

describe.skipIf(!hasDb)("CRM (DB)", () => {
  beforeAll(async () => {
    admin = asUser(await prisma.user.findFirstOrThrow({ where: { isAdmin: true } }), adminPermissions(), true);
    const perms = mergePermissions([
      flagsToRow("crm.project", { view: true, create: true, edit: true, delete: true }),
      flagsToRow("crm.plan", { view: true, create: true }),
    ]);
    const mk = async (k: string) =>
      asUser(await prisma.user.create({ data: { email: `${TAG.toLowerCase()}-${k}@test.local`, passwordHash: "x", firstName: k, lastName: TAG } }), perms);
    sales = await mk("sales");
    other = await mk("other");
    customerId = (await prisma.contact.create({ data: { code: `${TAG}C`, name: `ลูกค้า ${TAG}`, isCustomer: true } })).id;
  });

  afterAll(async () => {
    if (!customerId) return;
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...projectIds, ...planIds, ...enIds] } } });
    await prisma.notification.deleteMany({ where: { docId: { in: enIds } } });
    await prisma.notificationDelivery.deleteMany({ where: { refId: { in: enIds } } });
    await prisma.workPlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.engineerDoc.deleteMany({ where: { id: { in: enIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.contact.delete({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
    await prisma.$disconnect();
  });

  it("โครงการ: เปลี่ยนสถานะเก็บในการเคลื่อนไหว; ลบไม่ได้ถ้ามีใบถอดแบบอ้างอิง", async () => {
    const base = { name: `โครงการ ${TAG}`, customerId, probability: 50, value: "192,085" };
    const p = await createProject(sales, projectSchema.parse(base), null);
    projectIds.push(p.id);
    expect(Number(p.value)).toBe(192085);
    await updateProject(sales, p.id, projectSchema.parse({ ...base, status: "QUOTED" }), null);
    await updateProject(sales, p.id, projectSchema.parse({ ...base, status: "QUOTED", note: "แก้หมายเหตุ" }), null);
    const logs = await prisma.auditLog.findMany({ where: { entityType: "Project", entityId: p.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["CREATE", "STATUS_CHANGE", "UPDATE"]);
    expect(logs[1].note).toBe("เปลี่ยนสถานะ: โครงการใหม่ → เสนอราคา");

    const en = await createEngineerDoc(admin, engineerDocSchema.parse({ docDate: today, revision: 1, workTypes: ["SURVEY"], projectName: p.name, projectId: p.id, customerId }), null);
    enIds.push(en.id);
    await expectError(deleteProject(sales, p.id, null), 409);
    await cancelEngineerDoc(admin, en.id, "ทดสอบ", null);
    await deleteProject(sales, p.id, null);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).not.toBeNull();
    await expectError(updateProject(sales, p.id, projectSchema.parse(base), null), 404);
  });

  it("ลูกค้าของโครงการต้องเป็นลูกค้า; จำนวนโครงการของผู้ติดต่อไม่นับที่ลบ", async () => {
    const vendor = await prisma.contact.create({ data: { code: `${TAG}V`, name: `ผู้ขาย ${TAG}`, isVendor: true } });
    try {
      await expectError(createProject(sales, projectSchema.parse({ name: `x ${TAG}`, customerId: vendor.id }), null), 400);
    } finally {
      await prisma.contact.delete({ where: { id: vendor.id } });
    }
    const p = await createProject(sales, projectSchema.parse({ name: `นับ ${TAG}`, customerId }), null);
    projectIds.push(p.id);
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: customerId }, include: { _count: { select: { projects: { where: { deletedAt: null } } } } } });
    expect(c._count.projects).toBe(1);
  });

  it("แผนการทำงาน: เช็คอินเริ่มต้น → จุดหมาย คำนวณระยะทาง, เวลาเป็นของ server, เฉพาะเจ้าของแผน", async () => {
    const plan = await createPlan(
      sales,
      workPlanSchema.parse({ subject: `เยี่ยม ${TAG}`, plannedStart: `${today}T09:00`, plannedEnd: `${today}T11:00`, employeeId: sales.id, customerId }),
      null,
    );
    planIds.push(plan.id);
    expect(plan.plannedStart.toISOString()).toBe(`${today}T02:00:00.000Z`);

    await expectError(runPlanAction(sales, plan.id, { action: "checkin_end", ...B }, null), 409);
    await expectError(runPlanAction(admin, plan.id, { action: "checkin_start", ...A }, null), 403); // admin ไม่ใช่เจ้าของแผน
    const before = Date.now();
    expect((await runPlanAction(sales, plan.id, { action: "checkin_start", ...A, accuracy: 12.4 }, null)).status).toBe("CHECKED_IN");
    // กดซ้ำพร้อมกัน: สำเร็จครั้งเดียว
    const r = await Promise.allSettled([
      runPlanAction(sales, plan.id, { action: "checkin_end", ...B }, null),
      runPlanAction(sales, plan.id, { action: "checkin_end", lat: 0, lng: 0 }, null),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const p = await prisma.workPlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(p.status).toBe("DONE");
    expect(p.startAccuracy).toBe(12);
    expect(p.startAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);
    expect(Number(p.distanceKm)).toBeCloseTo(haversineKm(A, B), 3);
    expect(Number(p.distanceKm)).toBeGreaterThan(9);
    expect(p.distanceSource).toBe("haversine");
    await expectError(updatePlan(sales, plan.id, workPlanSchema.parse({ subject: "x", plannedStart: `${today}T09:00`, plannedEnd: `${today}T10:00`, employeeId: sales.id }), null), 409);
    const logs = await prisma.auditLog.findMany({ where: { entityType: "WorkPlan", entityId: plan.id } });
    expect(logs.map((l) => l.note).filter(Boolean).sort()).toEqual(["เช็คอิน จุดหมาย", "เช็คอิน จุดเริ่มต้น"]);
  });

  it("แผนการทำงาน: เสร็จสิ้น/ยกเลิกแบบไม่เช็คอิน และสิทธิ์แก้ไขของคนอื่น", async () => {
    const mk = async () => {
      const x = await createPlan(sales, workPlanSchema.parse({ subject: `แผน ${TAG}`, plannedStart: `${today}T13:00`, plannedEnd: `${today}T14:00`, employeeId: sales.id }), null);
      planIds.push(x.id);
      return x.id;
    };
    const p1 = await mk();
    // other มีแค่ view/create ไม่ใช่เจ้าของ → เสร็จสิ้น/ยกเลิก/แก้ไขไม่ได้
    await expectError(runPlanAction(other, p1, { action: "complete" }, null), 403);
    await expectError(runPlanAction(other, p1, { action: "cancel" }, null), 403);
    await expectError(updatePlan(other, p1, workPlanSchema.parse({ subject: "x", plannedStart: `${today}T09:00`, plannedEnd: `${today}T10:00`, employeeId: sales.id }), null), 403);
    expect((await runPlanAction(sales, p1, { action: "complete" }, null)).distanceKm).toBeNull();
    const p2 = await mk();
    await runPlanAction(admin, p2, { action: "cancel", reason: "ลูกค้าเลื่อน" }, null);
    expect(await prisma.workPlan.findUniqueOrThrow({ where: { id: p2 } })).toMatchObject({ status: "CANCELLED", cancelReason: "ลูกค้าเลื่อน" });
  });
});
