import { describe, expect, it } from "vitest";
import {
  canManageFile,
  canRunTransition,
  checkAdvance,
  checkEngineerFile,
  ENGINEER_STEPS,
  engineerStepper,
  fileExt,
  fileKindOpen,
  isInlineType,
  nextTransition,
  TRANSITIONS,
  type GuardState,
} from "@/lib/engineer-workflow";
import { flagsToRow, mergePermissions } from "@/lib/rbac";
import { engineerInAppText, engineerLineText } from "@/lib/notifications";
import { engineerDocSchema } from "@/lib/validators";

const perms = (f: Record<string, boolean>) => mergePermissions([flagsToRow("engineer.document", f)]);
const EDIT = perms({ view: true, edit: true });
const APPROVE = perms({ view: true, approve: true });
const VIEW = perms({ view: true });
const ALL = perms({ view: true, create: true, edit: true, approve: true, cancel: true });
const OK: GuardState = { customerId: "c1", assigneeId: "u1", workTypes: ["SURVEY"], returnDocCount: 1, estimateLineCount: 1 };

describe("state machine ใบถอดแบบ/ติดตั้ง", () => {
  it("เดินครบ 9 ขั้นตามลำดับ ปุ่มสลับ ดำเนินการต่อ / อนุมัติ และจบด้วย บันทึก", () => {
    let s: (typeof ENGINEER_STEPS)[number] = "DRAFT";
    const seen = [s as string];
    const labels: string[] = [];
    for (;;) {
      const t = nextTransition(s);
      if (!t) break;
      labels.push(t.label);
      s = t.to;
      seen.push(s);
    }
    expect(seen).toEqual([...ENGINEER_STEPS]);
    expect(labels).toEqual(["ดำเนินการต่อ", "อนุมัติ", "ดำเนินการต่อ", "อนุมัติ", "ดำเนินการต่อ", "ดำเนินการต่อ", "อนุมัติ", "บันทึกเสร็จสิ้น"]);
    expect(TRANSITIONS.filter((t) => t.label === "อนุมัติ").every((t) => t.perm === "approve")).toBe(true);
    expect(nextTransition("COMPLETED")).toBeNull();
    expect(nextTransition("CANCELLED")).toBeNull();
  });

  it("สิทธิ์ต่อ transition: แก้ไข vs อนุมัติ", () => {
    expect(checkAdvance("DRAFT", "DRAFT", EDIT, "x", OK).ok).toBe(true);
    expect(checkAdvance("DRAFT", "DRAFT", APPROVE, "x", OK)).toMatchObject({ ok: false, status: 403 });
    expect(checkAdvance("NEW", "NEW", EDIT, "x", OK)).toMatchObject({ ok: false, status: 403 });
    expect(checkAdvance("NEW", "NEW", APPROVE, "x", OK).ok).toBe(true);
    expect(checkAdvance("INSPECTION", "INSPECTION", APPROVE, "x", OK).ok).toBe(true);
    expect(checkAdvance("ESTIMATE", "ESTIMATE", EDIT, "x", OK).ok).toBe(true);
    expect(checkAdvance("ESTIMATE", "ESTIMATE", VIEW, "x", OK)).toMatchObject({ ok: false, status: 403 });
  });

  it("ผู้รับผิดชอบงานกดขั้น ดำเนินงาน / ส่งตรวจรับ ได้แม้ไม่มีสิทธิ์แก้ไข แต่ต้องดูเมนูได้", () => {
    const t1 = nextTransition("ASSIGNED")!;
    const t2 = nextTransition("IN_PROGRESS")!;
    expect(canRunTransition(t1, VIEW, "u1", "u1")).toBe(true);
    expect(canRunTransition(t2, VIEW, "u1", "u1")).toBe(true);
    expect(canRunTransition(t1, VIEW, "u2", "u1")).toBe(false);
    expect(canRunTransition(t1, perms({}), "u1", "u1")).toBe(false);
    // ขั้นอนุมัติ ผู้รับผิดชอบกดเองไม่ได้
    expect(canRunTransition(nextTransition("INSPECTION")!, VIEW, "u1", "u1")).toBe(false);
  });

  it("เงื่อนไขก่อนเปลี่ยนขั้น", () => {
    expect(checkAdvance("DRAFT", "DRAFT", ALL, "x", { ...OK, customerId: null })).toMatchObject({ ok: false, status: 400 });
    expect(checkAdvance("QUEUED", "QUEUED", ALL, "x", { ...OK, assigneeId: null })).toMatchObject({ ok: false, status: 400 });
    expect(checkAdvance("IN_PROGRESS", "IN_PROGRESS", ALL, "x", { ...OK, returnDocCount: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(checkAdvance("ESTIMATE", "ESTIMATE", ALL, "x", { ...OK, estimateLineCount: 0 })).toMatchObject({ ok: false, status: 400 });
    // งานติดตั้งอย่างเดียว ไม่บังคับใบสรุปประมาณ
    expect(checkAdvance("ESTIMATE", "ESTIMATE", ALL, "x", { ...OK, workTypes: ["INSTALL"], estimateLineCount: 0 }).ok).toBe(true);
  });

  it("กดจากหน้าจอเก่า (ขั้นไม่ตรง) = 409; เอกสารจบแล้ว = 409", () => {
    expect(checkAdvance("REVIEWED", "NEW", ALL, "x", OK)).toMatchObject({ ok: false, status: 409 });
    expect(checkAdvance("COMPLETED", "COMPLETED", ALL, "x", OK)).toMatchObject({ ok: false, status: 409 });
    expect(checkAdvance("CANCELLED", "CANCELLED", ALL, "x", OK)).toMatchObject({ ok: false, status: 409 });
  });

  it("ไฟล์แนบ: แบบจากลูกค้าแนบได้ทุกขั้นที่ยังไม่จบ, เอกสารส่งกลับตั้งแต่มอบหมาย", () => {
    expect(fileKindOpen("CUSTOMER_DRAWING", "DRAFT")).toBe(true);
    expect(fileKindOpen("CUSTOMER_DRAWING", "COMPLETED")).toBe(false);
    expect(fileKindOpen("RETURN_DOC", "QUEUED")).toBe(false);
    expect(fileKindOpen("RETURN_DOC", "ASSIGNED")).toBe(true);
    expect(fileKindOpen("RETURN_DOC", "ESTIMATE")).toBe(true);
    expect(fileKindOpen("RETURN_DOC", "CANCELLED")).toBe(false);
    expect(canManageFile("CUSTOMER_DRAWING", EDIT, "u1", null)).toBe(true);
    expect(canManageFile("CUSTOMER_DRAWING", VIEW, "u1", "u1")).toBe(false);
    expect(canManageFile("RETURN_DOC", VIEW, "u1", "u1")).toBe(true);
    expect(canManageFile("RETURN_DOC", VIEW, "u2", "u1")).toBe(false);
  });

  it("ตรวจชนิด/ขนาดไฟล์", () => {
    expect(fileExt("แบบ.บ้าน.DWG")).toBe(".dwg");
    expect(checkEngineerFile("a.pdf", 100)).toBeNull();
    expect(checkEngineerFile("a.exe", 100)).toMatch(/ไม่รองรับ/);
    expect(checkEngineerFile("a.html", 100)).toMatch(/ไม่รองรับ/);
    expect(checkEngineerFile("a.svg", 100)).toMatch(/ไม่รองรับ/);
    expect(checkEngineerFile("a.pdf", 26 * 1024 * 1024)).toMatch(/25MB/);
    expect(isInlineType("application/pdf")).toBe(true);
    expect(isInlineType("application/zip")).toBe(false);
  });

  it("stepper: ขั้นก่อนหน้า done, ขั้นปัจจุบัน current; ยกเลิกแสดงขั้นที่ไปถึง", () => {
    const st = engineerStepper("QUEUED");
    expect(st.map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo", "todo", "todo", "todo", "todo"]);
    expect(engineerStepper("COMPLETED").every((s) => s.state === "done")).toBe(true);
    expect(engineerStepper("CANCELLED", "NEW").map((s) => s.state).slice(0, 3)).toEqual(["done", "done", "todo"]);
  });
});

describe("validator ใบถอดแบบ", () => {
  const base = { docDate: "2026-11-25", revision: "1", workTypes: ["SURVEY"], projectName: "บ้านคุณเอ" };
  it("ต้องมีชื่อโครงการและประเภทงาน", () => {
    expect(engineerDocSchema.safeParse(base).success).toBe(true);
    expect(engineerDocSchema.safeParse({ ...base, projectName: " " }).success).toBe(false);
    expect(engineerDocSchema.safeParse({ ...base, workTypes: [] }).success).toBe(false);
  });
  it("วันที่กำหนดส่งต้องไม่ก่อนวันที่เริ่มงาน", () => {
    expect(engineerDocSchema.safeParse({ ...base, startDate: "2026-11-25", dueDate: "2026-11-24" }).success).toBe(false);
    expect(engineerDocSchema.safeParse({ ...base, startDate: "2026-11-25", dueDate: "2026-11-25" }).success).toBe(true);
  });
  it("ตัดผู้เกี่ยวข้อง/ประเภทงานซ้ำ", () => {
    const d = engineerDocSchema.parse({ ...base, workTypes: ["SURVEY", "SURVEY", "INSTALL"], participantIds: ["a", "a", "b"] });
    expect(d.workTypes).toEqual(["SURVEY", "INSTALL"]);
    expect(d.participantIds).toEqual(["a", "b"]);
  });
});

describe("ข้อความแจ้งเตือนใบถอดแบบ", () => {
  const e = { kind: "advanced" as const, docId: "d1", docNo: "EN2611250001", projectName: "บ้านคุณเอ", status: "REVIEWED" as const, fromStatus: "NEW" as const, actorId: "a" };
  it("LINE: ขั้นเดิม → ขั้นใหม่ + เลขที่ + ผู้ทำ + ลิงก์", () => {
    const t = engineerLineText(e, "สมชาย ใจดี");
    expect(t).toContain("[ถอดแบบ/ติดตั้ง] งานถอดแบบใหม่ → ตรวจสอบแล้ว");
    expect(t).toContain("EN2611250001");
    expect(t).toContain("โดย: สมชาย ใจดี");
    expect(t).toMatch(/\/engineer\/documents\/d1$/);
    expect(engineerLineText({ ...e, kind: "created", status: "DRAFT", fromStatus: null }, null)).toContain("สร้างเอกสาร");
  });
  it("ในระบบ: แยกข้อความตามบทบาท; สร้างเอกสารไม่แจ้งในระบบ", () => {
    expect(engineerInAppText({ ...e, status: "ASSIGNED" }, "assignee", "ก")!.title).toBe("คุณได้รับมอบหมายงาน ใบถอดแบบ EN2611250001");
    expect(engineerInAppText(e, "involved", "ก")!.title).toBe("ใบถอดแบบ EN2611250001 → ตรวจสอบแล้ว");
    expect(engineerInAppText({ ...e, kind: "created" }, "involved", "ก")).toBeNull();
  });
});
