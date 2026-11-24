import { describe, expect, it } from "vitest";
import { calcPurchaseOrder, formatMoney } from "@/lib/purchase-calc";
import {
  approveTransition,
  canActOnApproval,
  fulfillmentStatus,
  rejectTransition,
  statusSteps,
  submitTransition,
  type ApprovalDocState,
  type ApprovalSnapshot,
} from "@/lib/approval";
import { purchaseOrderSchema, purchaseRequestSchema, purchaseReturnSchema } from "@/lib/validators";

describe("สูตรราคาใบสั่งซื้อ", () => {
  it("ตัวอย่างในแผน: 10 × 1,250 − 500 = 12,000 → VAT แยกนอก 840 → 12,840", () => {
    const c = calcPurchaseOrder({ lines: [{ quantity: 10, unitPrice: 1250, discount: 500 }], vatMode: "EXCLUSIVE" });
    expect(c).toMatchObject({ lineAmounts: [12000], subtotal: 12000, afterDiscount: 12000, beforeVat: 12000, vatAmount: 840, total: 12840, errors: [] });
  });

  it("VAT รวมใน: 10,700 → ก่อน VAT 10,000 VAT 700", () => {
    const c = calcPurchaseOrder({ lines: [{ quantity: 1, unitPrice: 10700 }], vatMode: "INCLUSIVE" });
    expect(c).toMatchObject({ total: 10700, vatAmount: 700, beforeVat: 10000 });
  });

  it("ไม่มี VAT + ส่วนลดท้ายบิล", () => {
    const c = calcPurchaseOrder({ lines: [{ quantity: 2, unitPrice: 100 }, { quantity: 1, unitPrice: 50 }], headerDiscount: 50, vatMode: "NONE" });
    expect(c).toMatchObject({ subtotal: 250, afterDiscount: 200, vatAmount: 0, total: 200 });
  });

  it("ปัดเศษ 2 ตำแหน่งแบบครึ่งขึ้น (ไม่มีเศษ float)", () => {
    // 3 × 33.335 = 100.005 → 100.01
    expect(calcPurchaseOrder({ lines: [{ quantity: 3, unitPrice: "33.335" }], vatMode: "NONE" }).lineAmounts).toEqual([100.01]);
    // 0.1 + 0.2 แบบ float = 0.30000000000000004 ต้องได้ 0.3
    expect(calcPurchaseOrder({ lines: [{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }], vatMode: "NONE" }).total).toBe(0.3);
    // VAT 7% ของ 0.07 = 0.0049 → 0.00, ของ 0.08 = 0.0056 → 0.01
    expect(calcPurchaseOrder({ lines: [{ quantity: 1, unitPrice: 0.07 }], vatMode: "EXCLUSIVE" }).vatAmount).toBe(0);
    expect(calcPurchaseOrder({ lines: [{ quantity: 1, unitPrice: 0.08 }], vatMode: "EXCLUSIVE" }).vatAmount).toBe(0.01);
    // จำนวนทศนิยม 3 ตำแหน่ง × ราคา 4 ตำแหน่ง
    expect(calcPurchaseOrder({ lines: [{ quantity: "1.5", unitPrice: "12.3456" }], vatMode: "NONE" }).lineAmounts).toEqual([18.52]);
  });

  it("ส่วนลดเกินยอด = error", () => {
    expect(calcPurchaseOrder({ lines: [{ quantity: 1, unitPrice: 100, discount: 101 }], vatMode: "NONE" }).errors[0]).toMatch(/ส่วนลดมากกว่ายอด/);
    expect(calcPurchaseOrder({ lines: [{ quantity: 1, unitPrice: 100 }], headerDiscount: 101, vatMode: "NONE" }).errors[0]).toMatch(/ท้ายบิลมากกว่า/);
  });

  it("formatMoney", () => {
    expect(formatMoney(192085)).toBe("192,085.00");
    expect(formatMoney("0.5")).toBe("0.50");
  });
});

const snap = (steps: string[][]): ApprovalSnapshot => ({
  steps: steps.map((ids, i) => ({ stepNo: i + 1, approverIds: ids, approverNames: ids })),
});
const doc = (over: Partial<ApprovalDocState>): ApprovalDocState => ({ status: "DRAFT", currentStep: null, approvalRound: 0, approvalSnapshot: null, ...over });

describe("approval engine", () => {
  it("2 ลำดับ: ลำดับ 1 มี A,B — แค่ A กดก็ไปลำดับ 2; คนนอกลำดับกดไม่ได้", () => {
    const s = snap([["A", "B"], ["C"]]);
    const sub = submitTransition(doc({ approvalSnapshot: s }));
    expect(sub).toEqual({ status: "PENDING", currentStep: 1, approvalRound: 1 });
    const pending = doc({ status: "PENDING", currentStep: 1, approvalRound: 1, approvalSnapshot: s });
    expect(canActOnApproval(pending, "A", false)).toBe(true);
    expect(canActOnApproval(pending, "B", false)).toBe(true);
    expect(canActOnApproval(pending, "C", true)).toBe(false); // อยู่ลำดับ 2 ยังกดไม่ได้ แม้มีสิทธิ์อนุมัติ
    expect(canActOnApproval(pending, "X", true)).toBe(false);
    const next = approveTransition(pending);
    expect(next).toEqual({ status: "PENDING", currentStep: 2 });
    const step2 = doc({ ...pending, currentStep: 2 });
    expect(canActOnApproval(step2, "A", false)).toBe(false);
    expect(canActOnApproval(step2, "C", false)).toBe(true);
    expect(approveTransition(step2)).toEqual({ status: "APPROVED", currentStep: null, approved: true });
  });

  it("ไม่มีผังอนุมัติ: ผู้มีสิทธิ์ 'อนุมัติ' กดได้ครั้งเดียวจบ", () => {
    const pending = doc({ status: "PENDING", currentStep: null, approvalRound: 1, approvalSnapshot: snap([]) });
    expect(canActOnApproval(pending, "anyone", true)).toBe(true);
    expect(canActOnApproval(pending, "anyone", false)).toBe(false);
    expect(approveTransition(pending)).toEqual({ status: "APPROVED", currentStep: null, approved: true });
  });

  it("ไม่อนุมัติ → กลับเป็นร่าง; ส่งใหม่ = รอบใหม่ เริ่มลำดับ 1", () => {
    const s = snap([["A"], ["B"]]);
    const pending = doc({ status: "PENDING", currentStep: 2, approvalRound: 1, approvalSnapshot: s });
    expect(rejectTransition(pending)).toEqual({ status: "DRAFT", currentStep: null });
    expect(submitTransition(doc({ status: "DRAFT", approvalRound: 1, approvalSnapshot: s }))).toEqual({ status: "PENDING", currentStep: 1, approvalRound: 2 });
  });

  it("เปลี่ยนสถานะผิดลำดับไม่ได้", () => {
    expect(submitTransition(doc({ status: "PENDING" }))).toMatch(/เฉพาะเอกสารที่เป็นร่าง/);
    expect(approveTransition(doc({ status: "APPROVED" }))).toMatch(/ไม่ได้อยู่ระหว่างรออนุมัติ/);
    expect(canActOnApproval(doc({ status: "DRAFT", approvalSnapshot: snap([["A"]]) }), "A", true)).toBe(false);
  });

  it("สถานะหลังอนุมัติ: PR 10 → สั่ง 6 = บางส่วน → สั่งอีก 4 = ครบ", () => {
    expect(fulfillmentStatus([{ qtyMilli: 10000, doneMilli: 0 }])).toBe("APPROVED");
    expect(fulfillmentStatus([{ qtyMilli: 10000, doneMilli: 6000 }])).toBe("PARTIAL");
    expect(fulfillmentStatus([{ qtyMilli: 10000, doneMilli: 10000 }])).toBe("COMPLETED");
    expect(fulfillmentStatus([{ qtyMilli: 10000, doneMilli: 10000 }, { qtyMilli: 5000, doneMilli: 0 }])).toBe("PARTIAL");
  });

  it("stepper", () => {
    const st = statusSteps("PO", "PARTIAL");
    expect(st.map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo"]);
    expect(st[3].label).toBe("นำเข้าแล้วบางส่วน");
  });
});

describe("validators เฟส 5", () => {
  it("PR ต้องมีรายการ และจำนวน > 0", () => {
    const r = purchaseRequestSchema.safeParse({ docDate: "2026-11-24", requesterId: "u", lines: [] });
    expect(r.error!.issues[0].message).toMatch(/อย่างน้อย 1 รายการ/);
    expect(purchaseRequestSchema.safeParse({ docDate: "2026-11-24", requesterId: "u", lines: [{ productId: "p", quantity: 0 }] }).success).toBe(false);
  });

  it("PO: ราคา/ส่วนลดไม่ติดลบ, ห้ามอ้าง PR line ซ้ำ, VAT ค่าเริ่มต้นแยกนอก", () => {
    const base = { docDate: "2026-11-24", vendorId: "v", lines: [{ productId: "p", quantity: 1, unitPrice: "1,250.50" }] };
    const ok = purchaseOrderSchema.parse(base);
    expect(ok.vatMode).toBe("EXCLUSIVE");
    expect(ok.lines[0]).toMatchObject({ unitPrice: 1250.5, discount: 0 });
    expect(purchaseOrderSchema.safeParse({ ...base, lines: [{ productId: "p", quantity: 1, unitPrice: -1 }] }).success).toBe(false);
    const dup = purchaseOrderSchema.safeParse({ ...base, lines: [base.lines[0], base.lines[0]].map((l) => ({ ...l, requestLineId: "r1" })) });
    expect(dup.error!.issues[0].message).toMatch(/PR ซ้ำ/);
  });

  it("ใบส่งคืนต้องมีเหตุผลและรายการ", () => {
    const r = purchaseReturnSchema.safeParse({ docDate: "2026-11-24", orderId: "o", reasonId: "", lines: [] });
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toContain("reasonId");
    expect(paths).toContain("lines");
  });
});
