// ใบถอดแบบ/ติดตั้งกับฐานข้อมูลจริง: เดินครบ 9 ขั้น, ประวัติทุกขั้น, สิทธิ์ต่อ transition, กดพร้อมกัน, แจ้งเตือน
// ข้อมูลมี tag "ZE…" ลบทิ้งตอนจบ; ตั้งค่าแจ้งเตือนโมดูลถอดแบบเดิมถูกเก็บแล้วคืนค่า
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { adminPermissions, flagsToRow, mergePermissions } from "@/lib/rbac";
import { engineerDocSchema } from "@/lib/validators";
import type { CurrentUser } from "@/lib/session";
import type { EngineerStatus } from "@/lib/engineer-workflow";
import {
  addEngineerFile,
  advanceEngineerDoc,
  cancelEngineerDoc,
  createEngineerDoc,
  removeEngineerFile,
  updateEngineerDoc,
} from "@/server/engineer-docs";

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = `ZE${Date.now().toString(36).toUpperCase()}`;
const GROUP = `C${TAG.toLowerCase()}0000000000`;
const today = new Date().toISOString().slice(0, 10);

const asUser = (u: { id: string; email: string; firstName: string; lastName: string }, permissions = adminPermissions(), isAdmin = false): CurrentUser => ({
  ...u,
  department: null,
  position: null,
  avatarKey: null,
  isAdmin,
  permissions,
});

let admin: CurrentUser;
let editor: CurrentUser; // แก้ไขได้ อนุมัติไม่ได้
let approver: CurrentUser; // อนุมัติได้ แก้ไขไม่ได้
let tech: CurrentUser; // ดูได้อย่างเดียว (ผู้รับผิดชอบงาน)
let watcher: CurrentUser; // ผู้เกี่ยวข้อง
let customerId = "";
let productId = "";
let savedSetting: { lineEnabled: boolean; lineGroupId: string | null; lineGroupName: string | null } | null = null;
const docIds: string[] = [];

const parse = (over: Record<string, unknown> = {}) =>
  engineerDocSchema.parse({ docDate: today, revision: 1, workTypes: ["SURVEY"], projectName: `โครงการ ${TAG}`, customerId, participantIds: [watcher.id], ...over });

async function expectError(p: Promise<unknown>, status: number) {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e, "ควร error").toBeInstanceOf(ApiError);
  expect((e as ApiError).status).toBe(status);
}

const fakeFile = (kind: "CUSTOMER_DRAWING" | "RETURN_DOC") => ({
  kind,
  key: `engineer/${TAG}/${Math.random().toString(36).slice(2)}.pdf`,
  fileName: `${TAG}.pdf`,
  contentType: "application/pdf",
  size: 10,
});

describe.skipIf(!hasDb)("ใบถอดแบบ/ติดตั้ง (DB)", () => {
  beforeAll(async () => {
    admin = asUser(await prisma.user.findFirstOrThrow({ where: { isAdmin: true } }), adminPermissions(), true);
    const mk = async (k: string, f: Record<string, boolean>) => {
      const u = await prisma.user.create({ data: { email: `${TAG.toLowerCase()}-${k}@test.local`, passwordHash: "x", firstName: k, lastName: TAG } });
      return asUser(u, mergePermissions([flagsToRow("engineer.document", f)]));
    };
    editor = await mk("editor", { view: true, create: true, edit: true, cancel: true });
    approver = await mk("approver", { view: true, approve: true });
    // ผู้รับแจ้งเตือน "รออนุมัติ" หาจากกลุ่มสิทธิ์ในฐานข้อมูล
    await prisma.permissionGroup.create({
      data: {
        name: `${TAG}-approve`,
        permissions: { create: [flagsToRow("engineer.document", { view: true, approve: true })] },
        members: { create: [{ userId: approver.id }] },
      },
    });
    tech = await mk("tech", { view: true });
    watcher = await mk("watcher", { view: true });
    customerId = (await prisma.contact.create({ data: { code: `${TAG}C`, name: `ลูกค้า ${TAG}`, isCustomer: true } })).id;
    const unit = await prisma.unit.findFirstOrThrow();
    productId = (await prisma.product.create({ data: { code: `${TAG}-P`, name: `สินค้า ${TAG}`, stockUnitId: unit.id } })).id;
    savedSetting = await prisma.notificationSetting.findUnique({ where: { module: "engineer" } });
    await prisma.notificationSetting.upsert({
      where: { module: "engineer" },
      create: { module: "engineer", lineEnabled: true, lineGroupId: GROUP },
      update: { lineEnabled: true, lineGroupId: GROUP, lineGroupName: null },
    });
  });

  afterAll(async () => {
    if (!customerId) return;
    if (savedSetting) await prisma.notificationSetting.update({ where: { module: "engineer" }, data: savedSetting });
    else await prisma.notificationSetting.deleteMany({ where: { module: "engineer" } });
    await prisma.notificationDelivery.deleteMany({ where: { OR: [{ target: GROUP }, { refId: { in: docIds } }] } });
    await prisma.notification.deleteMany({ where: { docId: { in: docIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...docIds, productId, customerId] } } });
    await prisma.engineerDoc.deleteMany({ where: { id: { in: docIds } } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.contact.delete({ where: { id: customerId } });
    await prisma.permissionGroup.deleteMany({ where: { name: `${TAG}-approve` } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
    await prisma.$disconnect();
  });

  it("เดินครบ 9 ขั้น ทุกขั้นมีประวัติ + audit + LINE และสิทธิ์ต่อ transition ถูกบังคับ", async () => {
    const doc = await createEngineerDoc(editor, parse(), null);
    docIds.push(doc.id);
    expect(doc.docNo).toMatch(/^EN\d{10}$/);
    expect(doc.status).toBe("DRAFT");

    const adv = (u: CurrentUser, from: EngineerStatus) => advanceEngineerDoc(u, doc.id, from, null, null);

    expect((await adv(editor, "DRAFT")).status).toBe("NEW");
    await expectError(adv(editor, "NEW"), 403); // อนุมัติต้องใช้สิทธิ์อนุมัติ
    expect((await adv(approver, "NEW")).status).toBe("REVIEWED");
    await expectError(adv(approver, "REVIEWED"), 403); // ดำเนินการต่อต้องใช้สิทธิ์แก้ไข
    expect((await adv(editor, "REVIEWED")).status).toBe("QUEUED");
    await expectError(adv(approver, "QUEUED"), 400); // ยังไม่เลือกผู้รับผิดชอบ
    await updateEngineerDoc(editor, doc.id, parse({ assigneeId: tech.id }), null);
    expect((await adv(approver, "QUEUED")).status).toBe("ASSIGNED");
    // ผู้รับผิดชอบงาน (ดูได้อย่างเดียว) กดดำเนินงานเองได้
    expect((await adv(tech, "ASSIGNED")).status).toBe("IN_PROGRESS");
    await expectError(adv(tech, "IN_PROGRESS"), 400); // ยังไม่แนบเอกสารส่งกลับ
    await expectError(addEngineerFile(watcher, doc.id, fakeFile("RETURN_DOC"), null), 403); // ไม่ใช่ผู้รับผิดชอบ
    await expectError(addEngineerFile(tech, doc.id, fakeFile("CUSTOMER_DRAWING"), null), 403); // แบบจากลูกค้าต้องสิทธิ์แก้ไข
    await addEngineerFile(tech, doc.id, fakeFile("RETURN_DOC"), null);
    expect((await adv(tech, "IN_PROGRESS")).status).toBe("INSPECTION");
    await expectError(adv(tech, "INSPECTION"), 403);
    expect((await adv(approver, "INSPECTION")).status).toBe("ESTIMATE");
    await expectError(adv(editor, "ESTIMATE"), 400); // งานถอดแบบต้องมีใบสรุปประมาณ
    await updateEngineerDoc(editor, doc.id, parse({ assigneeId: tech.id, estimateLines: [{ productId, quantity: "12.5", note: "รวมเผื่อ 5%" }] }), null);
    expect((await adv(editor, "ESTIMATE")).status).toBe("COMPLETED");

    const final = await prisma.engineerDoc.findUniqueOrThrow({ where: { id: doc.id }, include: { estimateLines: true, stepLogs: { orderBy: { createdAt: "asc" } } } });
    expect(final.completedAt).not.toBeNull();
    expect(final.estimateLines.map((l) => Number(l.quantity))).toEqual([12.5]);
    expect(final.stepLogs.map((s) => s.toStatus)).toEqual(["DRAFT", "NEW", "REVIEWED", "QUEUED", "ASSIGNED", "IN_PROGRESS", "INSPECTION", "ESTIMATE", "COMPLETED"]);
    expect(final.stepLogs.slice(1).every((s, i) => s.fromStatus === final.stepLogs[i].toStatus)).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { entityType: "EngineerDoc", entityId: doc.id } });
    expect(audits.filter((a) => a.action === "APPROVE")).toHaveLength(3);
    expect(audits.filter((a) => a.action === "STATUS_CHANGE")).toHaveLength(5);

    // LINE: สร้าง 1 + เปลี่ยนขั้น 8
    const line = await prisma.notificationDelivery.findMany({ where: { refId: doc.id }, orderBy: { createdAt: "asc" } });
    expect(line).toHaveLength(9);
    expect(line.every((d) => d.module === "engineer" && d.target === GROUP)).toBe(true);
    expect(line[0].message).toContain("สร้างเอกสาร");
    expect(line[8].message).toContain("ใบสรุปประมาณถอดแบบ → เสร็จสิ้น");

    // ในระบบ: ผู้รับผิดชอบได้ "ได้รับมอบหมาย", ผู้เกี่ยวข้องได้ทุกขั้น (ยกเว้นตอนสร้าง), ผู้อนุมัติได้ "รออนุมัติ"
    const inbox = (u: CurrentUser) => prisma.notification.findMany({ where: { userId: u.id, docId: doc.id }, orderBy: { createdAt: "asc" } });
    expect((await inbox(tech)).map((n) => n.title)).toContain(`คุณได้รับมอบหมายงาน ใบถอดแบบ ${doc.docNo}`);
    expect(await inbox(watcher)).toHaveLength(8);
    // ถึงขั้นที่ต้องอนุมัติ 3 ครั้ง (งานถอดแบบใหม่, รับลงคิว, ตรวจรับงาน) — ทุกครั้งผู้กดคือคนอื่น
    expect((await inbox(approver)).map((n) => n.title)).toEqual([
      `ใบถอดแบบ ${doc.docNo} รออนุมัติ (งานถอดแบบใหม่)`,
      `ใบถอดแบบ ${doc.docNo} รออนุมัติ (รับลงคิว)`,
      `ใบถอดแบบ ${doc.docNo} รออนุมัติ (ตรวจรับงาน)`,
    ]);
    expect((await inbox(editor)).every((n) => n.link === `/engineer/documents/${doc.id}`)).toBe(true);

    // เสร็จสิ้นแล้ว: แก้ไข/ยกเลิก/แนบไฟล์ไม่ได้
    await expectError(updateEngineerDoc(editor, doc.id, parse({ assigneeId: tech.id }), null), 409);
    await expectError(cancelEngineerDoc(editor, doc.id, "x", null), 409);
    await expectError(addEngineerFile(editor, doc.id, fakeFile("CUSTOMER_DRAWING"), null), 409);
  });

  it("กด ดำเนินการต่อ พร้อมกัน 2 ครั้ง: สำเร็จครั้งเดียว ขั้นไม่ข้าม", async () => {
    const doc = await createEngineerDoc(editor, parse(), null);
    docIds.push(doc.id);
    const results = await Promise.allSettled([advanceEngineerDoc(editor, doc.id, "DRAFT", null, null), advanceEngineerDoc(admin, doc.id, "DRAFT", null, null)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as ApiError).status).toBe(409);
    const d = await prisma.engineerDoc.findUniqueOrThrow({ where: { id: doc.id }, include: { stepLogs: true } });
    expect(d.status).toBe("NEW");
    expect(d.stepLogs).toHaveLength(2);
  });

  it("ร่างต้องมีลูกค้าก่อนดำเนินการต่อ; ยกเลิกเก็บขั้นเดิมไว้ในประวัติ; ลบไฟล์", async () => {
    const doc = await createEngineerDoc(editor, parse({ customerId: null, workTypes: ["INSTALL"] }), null);
    docIds.push(doc.id);
    await expectError(advanceEngineerDoc(editor, doc.id, "DRAFT", null, null), 400);
    const f = await addEngineerFile(editor, doc.id, fakeFile("CUSTOMER_DRAWING"), null);
    await expectError(addEngineerFile(editor, doc.id, fakeFile("RETURN_DOC"), null), 409); // เอกสารส่งกลับยังแนบไม่ได้
    expect(await removeEngineerFile(editor, doc.id, f.id, null)).toBe(f.key);
    await cancelEngineerDoc(editor, doc.id, `เลิกงาน ${TAG}`, null);
    const d = await prisma.engineerDoc.findUniqueOrThrow({ where: { id: doc.id }, include: { stepLogs: { orderBy: { createdAt: "asc" } } } });
    expect(d.status).toBe("CANCELLED");
    expect(d.stepLogs.at(-1)).toMatchObject({ fromStatus: "DRAFT", toStatus: "CANCELLED", comment: `เลิกงาน ${TAG}` });
    await expectError(advanceEngineerDoc(admin, doc.id, "CANCELLED", null, null), 409);
  });

  it("ลูกค้าต้องเป็นผู้ติดต่อประเภทลูกค้า; ผู้รับผิดชอบต้องเป็นผู้ใช้ที่ใช้งานอยู่", async () => {
    const vendor = await prisma.contact.create({ data: { code: `${TAG}V`, name: `ผู้ขาย ${TAG}`, isVendor: true } });
    try {
      await expectError(createEngineerDoc(editor, parse({ customerId: vendor.id }), null), 400);
    } finally {
      await prisma.contact.delete({ where: { id: vendor.id } });
    }
    await prisma.user.update({ where: { id: watcher.id }, data: { status: "INACTIVE" } });
    try {
      await expectError(createEngineerDoc(editor, parse({ assigneeId: watcher.id, participantIds: [] }), null), 400);
    } finally {
      await prisma.user.update({ where: { id: watcher.id }, data: { status: "ACTIVE" } });
    }
  });
});
