import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineConfigured, pushText, verifyLineSignature } from "@/lib/line";
import { MAX_ATTEMPTS, nextAttemptAfter, purchaseInAppText, purchaseLineText, RETRY_DELAYS_MS, type PurchaseEvent } from "@/lib/notifications";
import { retryKeyFor } from "@/lib/notification-worker";

const res = (status: number, body = "") => new Response(body, { status });

describe("LINE push", () => {
  beforeEach(() => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "test-token");
    vi.stubEnv("LINE_API_BASE", "https://line.test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ส่ง push ไปที่ groupId พร้อม token และ retry key", async () => {
    const f = vi.fn(async () => res(200, "{}"));
    expect(await pushText("C123", "สวัสดี", { retryKey: "k-1", fetchImpl: f as unknown as typeof fetch })).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://line.test/v2/bot/message/push");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    expect((init.headers as Record<string, string>)["X-Line-Retry-Key"]).toBe("k-1");
    expect(JSON.parse(init.body as string)).toEqual({ to: "C123", messages: [{ type: "text", text: "สวัสดี" }] });
  });

  it("409 (retry key ซ้ำ) = สำเร็จ, 429/5xx/network/timeout = ลองใหม่ได้, 4xx อื่น = ผิดถาวร", async () => {
    const run = (r: () => Promise<Response>, timeoutMs?: number) => pushText("C1", "x", { fetchImpl: r as unknown as typeof fetch, timeoutMs });
    expect(await run(async () => res(409))).toEqual({ ok: true });
    expect(await run(async () => res(500, "oops"))).toMatchObject({ ok: false, retryable: true, error: "LINE 500: oops" });
    expect(await run(async () => res(429))).toMatchObject({ ok: false, retryable: true });
    expect(await run(async () => res(400, '{"message":"The property, \'to\', in the request body is invalid"}'))).toMatchObject({ ok: false, retryable: false });
    expect(await run(async () => res(401))).toMatchObject({ ok: false, retryable: false });
    expect(await run(async () => Promise.reject(new TypeError("fetch failed")))).toMatchObject({ ok: false, retryable: true, error: expect.stringMatching(/เชื่อมต่อ LINE ไม่ได้/) });
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    expect(await pushText("C1", "x", { fetchImpl: hang as unknown as typeof fetch, timeoutMs: 20 })).toMatchObject({ ok: false, retryable: true, error: expect.stringMatching(/timeout/) });
  });

  it("ไม่มี token = ยังไม่ส่ง (ลองใหม่ได้เมื่อตั้งค่า)", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "");
    expect(lineConfigured()).toBe(false);
    const f = vi.fn();
    expect(await pushText("C1", "x", { fetchImpl: f as unknown as typeof fetch })).toMatchObject({ ok: false, retryable: true });
    expect(f).not.toHaveBeenCalled();
  });

  it("ข้อความยาวเกิน 5,000 ตัวอักษรถูกตัด", async () => {
    const f = vi.fn(async () => res(200));
    await pushText("C1", "ก".repeat(6000), { fetchImpl: f as unknown as typeof fetch });
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0].text.length).toBe(5000);
  });
});

describe("webhook signature", () => {
  it("ตรวจ HMAC-SHA256 base64 ด้วย channel secret", () => {
    const body = JSON.stringify({ events: [] });
    const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
    expect(verifyLineSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyLineSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifyLineSignature(body, sig, "other")).toBe(false);
    expect(verifyLineSignature(body, null, "s3cret")).toBe(false);
    expect(verifyLineSignature(body, sig, "")).toBe(false);
  });
});

describe("retry", () => {
  it("1 นาที → 5 นาที → 15 นาที → 1 ชม. → 6 ชม. แล้วเลิก (รวม 6 ครั้ง)", () => {
    const now = new Date("2026-11-24T00:00:00Z");
    expect(MAX_ATTEMPTS).toBe(6);
    expect([1, 2, 3, 4, 5].map((a) => nextAttemptAfter(a, now)!.getTime() - now.getTime())).toEqual(RETRY_DELAYS_MS);
    expect(nextAttemptAfter(6, now)).toBeNull();
  });

  it("retry key เป็น UUID และคงที่ต่อคิว", () => {
    const k = retryKeyFor("abc");
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(retryKeyFor("abc")).toBe(k);
    expect(retryKeyFor("abd")).not.toBe(k);
  });
});

describe("ข้อความแจ้งเตือน", () => {
  beforeEach(() => vi.stubEnv("APP_BASE_URL", "https://erp.biowood.test/"));
  afterEach(() => vi.unstubAllEnvs());
  const base: PurchaseEvent = { kind: "submitted", docType: "PO", docId: "po1", docNo: "PO2611240001", status: "PENDING", actorId: "u1", nextStep: 1 };

  it("LINE: เลขที่เอกสาร สถานะ ผู้ทำ ลิงก์", () => {
    expect(purchaseLineText(base, "สมชาย ใจดี")).toBe(
      ["[จัดซื้อ] ส่งอนุมัติ ใบสั่งซื้อ PO2611240001", "สถานะ: รออนุมัติ (ลำดับ 1)", "โดย: สมชาย ใจดี", "https://erp.biowood.test/purchase/orders/po1"].join("\n"),
    );
    const rej = purchaseLineText({ ...base, kind: "rejected", status: "DRAFT", comment: "ราคาสูง", nextStep: null }, "ผู้อนุมัติ");
    expect(rej).toContain("[จัดซื้อ] ไม่อนุมัติ ใบสั่งซื้อ PO2611240001");
    expect(rej).toContain("สถานะ: ร่าง");
    expect(rej).toContain("เหตุผล: ราคาสูง");
    const step = purchaseLineText({ ...base, kind: "step_approved", stepNo: 1, nextStep: 2 }, "A");
    expect(step).toContain("อนุมัติลำดับ 1 ใบสั่งซื้อ");
    expect(step).toContain("สถานะ: รออนุมัติ (ลำดับ 2)");
    expect(purchaseLineText({ ...base, docType: "PR", kind: "status", status: "PARTIAL", nextStep: null }, null)).toContain("สถานะ: สั่งซื้อแล้วบางส่วน");
  });

  it("ในระบบ: ผู้อนุมัติได้ 'รออนุมัติจากคุณ', เจ้าของเอกสารได้ผลอนุมัติ", () => {
    expect(purchaseInAppText(base, "approver", "สมชาย")).toEqual({ title: "ใบสั่งซื้อ PO2611240001 รออนุมัติจากคุณ", body: "ลำดับ 1 · ส่งอนุมัติ โดย สมชาย" });
    expect(purchaseInAppText(base, "owner", "สมชาย")).toBeNull();
    expect(purchaseInAppText({ ...base, kind: "rejected", status: "DRAFT", comment: "แก้จำนวน" }, "owner", "หัวหน้า")).toEqual({
      title: "ใบสั่งซื้อ PO2611240001 ไม่อนุมัติ",
      body: "เหตุผล: แก้จำนวน โดย หัวหน้า",
    });
    expect(purchaseInAppText({ ...base, kind: "created", status: "DRAFT" }, "owner", "x")).toBeNull();
  });
});
