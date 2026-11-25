import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, createUserWithPerms, loginOk, logout, uid } from "./helpers";

type Json = { id: string; docNo: string; [k: string]: unknown };
async function ok(r: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<Json> {
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as Json;
}

/** ลูกค้า (มีที่อยู่จดทะเบียน + ที่อยู่จัดส่ง) + สินค้า ของเทสเอง */
async function setup(page: Page) {
  const id = uid();
  const rq = page.request;
  const customerName = `ลูกค้า ${id}`;
  const customer = await ok(
    await rq.post("/api/contacts", {
      data: {
        isCustomer: true,
        isVendor: false,
        entityType: "INDIVIDUAL",
        name: customerName,
        reg: { address: "99/1", road: "สุขุมวิท", province: "กรุงเทพมหานคร", postalCode: "10110" },
        shippingAddresses: [{ label: "หน้างาน", address: "88 หมู่บ้านไม้งาม", province: "นนทบุรี", postalCode: "11000", isDefault: true }],
        channels: [],
        persons: [],
        tagIds: [],
      },
    }),
  );
  const unit = await ok(await rq.post("/api/inventory/units", { data: { name: `แผ่น${id}` } }));
  const productCode = `${id.toUpperCase()}-DECK`;
  await ok(await rq.post("/api/products", { data: { code: productCode, name: `ไม้พื้น ${id}`, isStockable: true, stockUnitId: unit.id, attributes: {} } }));
  return { id, customerId: customer.id, customerName, productCode };
}

const current = (page: Page) => page.getByTestId("engineer-stepper").locator('[aria-current="step"]');

/** กดปุ่มเปลี่ยนขั้น แล้วยืนยันใน dialog */
async function advance(page: Page, label: string, next: string) {
  const btn = page.getByTestId("advance-button");
  await expect(btn).toHaveText(new RegExp(label));
  await btn.click();
  await page.getByRole("dialog").getByRole("button", { name: `ยืนยัน${label}` }).click();
  if (next === "เสร็จสิ้น") await expect(page.getByTestId("engineer-stepper").locator('[data-state="todo"], [data-state="current"]')).toHaveCount(0);
  else await expect(current(page)).toHaveText(next);
}

function file(name: string) {
  return { name, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% ${name}\n`) };
}

test("ใบถอดแบบ/ติดตั้ง: สร้างผ่านฟอร์ม เลือกลูกค้า+ที่อยู่ แนบไฟล์ แล้วเดินครบ 9 ขั้น พร้อมประวัติทุกขั้น", async ({ page }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);

  await page.goto("/engineer/documents/new");
  await page.locator("#projectName").fill(`บ้านไม้ ${c.id}`);
  await page.getByLabel("ติดตั้ง", { exact: true }).click();
  await page.locator("#workDetail").fill("พื้นระเบียง รุ่น BW-150");
  // ลูกค้า: ดินสอ > เลือกลูกค้า > เลือกที่อยู่จดทะเบียน > เพิ่ม
  await page.getByRole("button", { name: "เลือกลูกค้า" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator("#customerPicker").click();
  await page.getByLabel("ค้นหาผู้ติดต่อ").fill(c.id);
  await page.getByRole("option", { name: new RegExp(c.id) }).click();
  await expect(dlg.getByText("ที่อยู่จัดส่ง: หน้างาน (หลัก)")).toBeVisible();
  await dlg.getByText("ที่อยู่จดทะเบียน", { exact: true }).click();
  await dlg.getByRole("button", { name: "เพิ่ม" }).click();
  await expect(page.getByTestId("customer-box")).toContainText(c.customerName);
  await expect(page.locator("#siteAddress")).toHaveValue(/สุขุมวิท/);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page).toHaveURL(/\/engineer\/documents\/(?!new)[a-z0-9]+$/);
  const docId = page.url().split("/").pop()!;
  await expect(page.locator("#docNumber")).toHaveValue(/^EN\d{10}$/);
  await expect(current(page)).toHaveText("ร่าง");

  // แนบแบบจากลูกค้า
  await page.getByTestId("file-input-CUSTOMER_DRAWING").setInputFiles(file(`แบบบ้าน ${c.id}.pdf`));
  await expect(page.getByTestId("files-CUSTOMER_DRAWING").getByTestId("engineer-file")).toHaveCount(1);
  const dl = await page.request.get(`/api/engineer/documents/${docId}/files/${(await (await page.request.get(`/api/engineer/documents/${docId}`)).json()).files[0].id}?download=1`);
  expect(dl.status()).toBe(200);
  expect(dl.headers()["content-disposition"]).toContain(`filename*=UTF-8''${encodeURIComponent(`แบบบ้าน ${c.id}.pdf`)}`);

  await advance(page, "ดำเนินการต่อ", "งานถอดแบบใหม่");
  await advance(page, "อนุมัติ", "ตรวจสอบแล้ว");
  await advance(page, "ดำเนินการต่อ", "รับลงคิว");
  // ต้องเลือกผู้รับผิดชอบก่อนอนุมัติมอบหมาย (กดแล้วระบบบันทึกให้ก่อน)
  await page.locator("#assigneeId").click();
  await page.getByLabel("ค้นหา", { exact: true }).fill("ผู้ดูแล");
  await page.getByRole("option", { name: /ผู้ดูแล/ }).first().click();
  await advance(page, "อนุมัติ", "มอบหมาย");
  await advance(page, "ดำเนินการต่อ", "ดำเนินงาน");
  // ยังไม่แนบเอกสารส่งกลับ → ไปต่อไม่ได้
  await page.getByTestId("advance-button").click();
  await page.getByRole("dialog").getByRole("button", { name: "ยืนยันดำเนินการต่อ" }).click();
  await expect(page.getByText(/กรุณาแนบ "เอกสารส่งกลับ"/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "ปิด" }).click();
  await page.getByTestId("file-input-RETURN_DOC").setInputFiles(file(`ผลถอดแบบ ${c.id}.pdf`));
  await expect(page.getByTestId("files-RETURN_DOC").getByTestId("engineer-file")).toHaveCount(1);
  await advance(page, "ดำเนินการต่อ", "ตรวจรับงาน");
  await advance(page, "อนุมัติ", "ใบสรุปประมาณถอดแบบ");

  // ใบสรุปประมาณถอดแบบ แล้ว "บันทึกเสร็จสิ้น"
  await page.getByTestId("estimate-card").getByRole("button", { name: "เพิ่มรายการ" }).click();
  await page.locator("#est-product-0").click();
  await page.getByLabel("ค้นหา", { exact: true }).fill(c.productCode);
  await page.getByRole("option", { name: new RegExp(c.productCode) }).click();
  await page.getByLabel("จำนวน รายการที่ 1").fill("36");
  await advance(page, "บันทึกเสร็จสิ้น", "เสร็จสิ้น");
  await expect(page.getByTestId("advance-button")).toHaveCount(0);
  await expect(page.locator("#projectName")).toBeDisabled();
  await expect(page.getByTestId("estimate-line")).toHaveCount(1);

  // ประวัติ: 9 ขั้น (สร้าง + เปลี่ยนขั้น 8 ครั้ง) และ audit log มีทุกขั้น
  await expect(page.getByTestId("engineer-steps").locator("li")).toHaveCount(9);
  await page.getByRole("button", { name: "ประวัติการเปลี่ยนแปลง" }).click();
  const audit = page.getByTestId("audit-list");
  for (const s of ["ร่าง → งานถอดแบบใหม่", "งานถอดแบบใหม่ → ตรวจสอบแล้ว", "ตรวจรับงาน → ใบสรุปประมาณถอดแบบ", "ใบสรุปประมาณถอดแบบ → เสร็จสิ้น"]) {
    await expect(audit.locator("p", { hasText: s })).toBeVisible();
  }

  // หน้ารายการ: ค้นหาเจอ สถานะเสร็จสิ้น, CSV มี BOM
  await page.goto("/engineer/documents");
  await page.getByPlaceholder(/ค้นหาเลขที่/).fill(c.id);
  await expect(page.getByRole("row", { name: new RegExp(`บ้านไม้ ${c.id}`) })).toContainText("เสร็จสิ้น");
  const csv = await page.request.get(`/api/engineer/documents?format=csv&q=${c.id}`);
  const body = await csv.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(body.toString("utf8")).toContain(`บ้านไม้ ${c.id}`);
});

test("สิทธิ์: ไม่มี view = ไม่เห็นเมนู + API 403; ดูอย่างเดียวเปลี่ยนขั้นไม่ได้; ไฟล์แนบเปิดผ่าน /api/files ไม่ได้", async ({ page, browser }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);
  const doc = await ok(
    await page.request.post("/api/engineer/documents", {
      data: { docDate: new Date().toISOString().slice(0, 10), revision: 1, workTypes: ["SURVEY"], projectName: `สิทธิ์ ${c.id}`, customerId: c.customerId },
    }),
  );
  const up = await page.request.post(`/api/engineer/documents/${doc.id}/files`, {
    multipart: { kind: "CUSTOMER_DRAWING", file: file(`x-${c.id}.pdf`) },
  });
  await ok(up);
  const none = await createUserWithPerms(page.request, { permissions: { "contacts.customer": { view: true } } });
  const viewer = await createUserWithPerms(page.request, { permissions: { "engineer.document": { view: true } } });
  // ไฟล์แนบใบถอดแบบต้องเปิดผ่าน route ที่ตรวจสิทธิ์เท่านั้น
  const detail = await (await page.request.get(`/api/engineer/documents/${doc.id}`)).json();
  expect((await page.request.get(`/api/files/${detail.files[0].key}`)).status()).toBe(404);
  await logout(page);

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, none.email, none.password);
  await expect(p2.getByRole("link", { name: "ใบถอดแบบ/ติดตั้ง" })).toHaveCount(0);
  expect((await p2.request.get("/api/engineer/documents")).status()).toBe(403);
  expect((await p2.request.get(`/api/engineer/documents/${doc.id}/files/${detail.files[0].id}`)).status()).toBe(403);
  expect((await p2.request.post(`/api/engineer/documents/${doc.id}/actions`, { data: { action: "advance", from: "DRAFT" } })).status()).toBe(403);
  await p2.goto(`/engineer/documents/${doc.id}`);
  await expect(p2).toHaveURL(/\/forbidden/);
  await ctx.close();

  const ctx2 = await browser.newContext();
  const p3 = await ctx2.newPage();
  await loginOk(p3, viewer.email, viewer.password);
  await p3.goto(`/engineer/documents/${doc.id}`);
  await expect(p3.locator("#projectName")).toBeDisabled();
  await expect(p3.getByTestId("advance-button")).toHaveCount(0);
  const r = await p3.request.post(`/api/engineer/documents/${doc.id}/actions`, { data: { action: "advance", from: "DRAFT" } });
  expect(r.status()).toBe(403);
  expect((await p3.request.patch(`/api/engineer/documents/${doc.id}`, { data: {} })).status()).toBe(403);
  expect((await p3.request.get(`/api/engineer/documents/${doc.id}/files/${detail.files[0].id}`)).status()).toBe(200);
  await ctx2.close();
});
