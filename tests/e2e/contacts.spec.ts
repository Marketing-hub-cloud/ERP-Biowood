import { expect, test } from "@playwright/test";
import { ADMIN, createUserWithPerms, loginOk, uid } from "./helpers";

const contactPayload = (name: string, roles: { isCustomer: boolean; isVendor: boolean }) => ({
  ...roles,
  entityType: "JURISTIC",
  name,
  reg: {},
  shippingAddresses: [],
  channels: [{ type: "PHONE", value: "02-000-0000" }],
  persons: [],
  tagIds: [],
});

test("สร้างผู้ติดต่อผ่านฟอร์ม (ลูกค้า+ผู้ขาย) พร้อมที่อยู่จัดส่ง ช่องทาง บุคคลติดต่อ tag แล้วขึ้นทั้งสองแท็บ", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const name = `บริษัท อีทูอี ${uid()} จำกัด`;

  await page.goto("/contacts/customers");
  await page.getByRole("link", { name: "สร้างผู้ติดต่อ" }).click();
  await expect(page).toHaveURL(/\/contacts\/new\?role=customer/);

  // validation: ไม่มีชื่อ
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("กรุณากรอกชื่อ")).toBeVisible();

  await page.locator("#isVendor").click();
  await page.locator("#name").fill(name);
  await page.locator("#taxId").fill("0105512345678");
  await page.locator("#reg-houseNo").fill("10/1");
  await page.locator("#reg-subdistrict").fill("บางนาใต้");
  await page.locator("#reg-district").fill("บางนา");
  await page.locator("#reg-province").fill("กรุงเทพมหานคร");
  await page.locator("#reg-postalCode").fill("10260");

  // ที่อยู่จัดส่ง: คัดลอกจากที่อยู่จดทะเบียน + เพิ่มอีก 1 แล้วลบ
  await page.getByRole("button", { name: "คัดลอกจากที่อยู่จดทะเบียน" }).click();
  await page.getByRole("button", { name: "เพิ่มที่อยู่" }).click();
  await expect(page.getByTestId("shipping-address")).toHaveCount(2);
  await page.getByRole("button", { name: "ลบที่อยู่จัดส่ง" }).nth(1).click();
  await expect(page.getByTestId("shipping-address")).toHaveCount(1);
  await expect(page.locator("#shippingAddresses-0-district")).toHaveValue("บางนา");

  // ช่องทางติดต่อ: แถวแรกมีให้แล้ว + เพิ่มอีเมลผิดรูปแบบ
  await page.getByLabel("ข้อมูลช่องทาง").first().fill("02-123-4567");
  await page.getByRole("button", { name: "เพิ่มช่องทาง" }).click();
  await page.getByLabel("ข้อมูลช่องทาง").nth(1).fill("wrong-email");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("รูปแบบอีเมลไม่ถูกต้อง")).toBeVisible();
  await page.getByLabel("ข้อมูลช่องทาง").nth(1).fill("e2e@example.com");

  // บุคคลติดต่อ
  await page.getByRole("button", { name: "เพิ่มบุคคลติดต่อ" }).click();
  await page.locator("#person-0-name").fill("คุณทดสอบ");
  await page.locator("#person-0-position").fill("จัดซื้อ");

  // tag ใหม่
  const tagName = `แท็ก-${uid()}`;
  await page.getByLabel("เพิ่มกลุ่ม").fill(tagName);
  await page.getByLabel("เพิ่มกลุ่ม").press("Enter");
  await expect(page.getByText(tagName)).toBeVisible();

  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page).toHaveURL(/\/contacts\/c[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.locator("#code")).toHaveValue(/^CT\d{5}$/);
  await expect(page.getByTestId("channel-row")).toHaveCount(2);
  await expect(page.getByTestId("person-row")).toHaveCount(1);

  // ขึ้นทั้งแท็บลูกค้าและผู้ขาย
  for (const tab of ["customers", "vendors", "all"]) {
    await page.goto(`/contacts/${tab}`);
    await page.getByLabel("ค้นหา").fill(name);
    await expect(page.locator("tbody")).toContainText(name);
  }

  // ค้นหาด้วยเบอร์โทร
  await page.getByLabel("ค้นหา").fill("02-123-4567");
  await expect(page.locator("tbody")).toContainText(name);
});

test("แก้ไข: audit log เก็บค่าก่อน/หลัง และลบแล้วหายจากรายการ", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const name = `ลบทดสอบ ${uid()}`;
  const res = await page.request.post("/api/contacts", { data: contactPayload(name, { isCustomer: true, isVendor: false }) });
  expect(res.status(), await res.text()).toBe(200);
  const { id } = await res.json();

  await page.goto(`/contacts/${id}`);
  await page.locator("#branch").fill("00009");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("บันทึกเรียบร้อย")).toBeVisible();
  await page.getByRole("button", { name: "ประวัติการเปลี่ยนแปลง" }).click();
  await expect(page.getByTestId("audit-list")).toContainText("00009");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "ลบผู้ติดต่อ" }).click();
  await page.getByRole("button", { name: "ยืนยันลบ" }).click();
  await expect(page).toHaveURL(/\/contacts\/customers/);
  await page.getByLabel("ค้นหา").fill(name);
  await expect(page.locator("tbody")).toContainText("ไม่พบข้อมูล");
  expect((await page.request.get(`/api/contacts/${id}`)).status()).toBe(404);
});

test("สิทธิ์ตามบทบาท: มีสิทธิ์แค่ผู้ขาย มองไม่เห็นลูกค้า และ API ได้ 403", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const tag = uid();
  const customer = await (await page.request.post("/api/contacts", { data: contactPayload(`ลูกค้าลับ ${tag}`, { isCustomer: true, isVendor: false }) })).json();
  const vendor = await (await page.request.post("/api/contacts", { data: contactPayload(`ผู้ขาย ${tag}`, { isCustomer: false, isVendor: true }) })).json();
  const both = await (await page.request.post("/api/contacts", { data: contactPayload(`ทั้งคู่ ${tag}`, { isCustomer: true, isVendor: true }) })).json();
  const u = await createUserWithPerms(page.request, { permissions: { "contacts.vendor": { view: true, create: true, edit: true, delete: true } } });

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, u.email, u.password);

  // เมนู
  await expect(p2.locator('aside [data-menu-key="contacts.vendor"]')).toBeVisible();
  await expect(p2.locator('aside [data-menu-key="contacts.customer"]')).toHaveCount(0);
  await p2.goto("/contacts/customers");
  await expect(p2).toHaveURL(/\/forbidden/);

  // รายการ "ทั้งหมด" เห็นเฉพาะที่เป็นผู้ขาย
  await p2.goto("/contacts/all");
  await p2.getByLabel("ค้นหา").fill(tag);
  await expect(p2.locator("tbody")).toContainText(`ผู้ขาย ${tag}`);
  await expect(p2.locator("tbody")).toContainText(`ทั้งคู่ ${tag}`);
  await expect(p2.locator("tbody")).not.toContainText(`ลูกค้าลับ ${tag}`);

  // API
  expect((await p2.request.get(`/api/contacts/${customer.id}`)).status()).toBe(403);
  expect((await p2.request.get(`/api/contacts/${vendor.id}`)).status()).toBe(200);
  // f_role=customer ยังเห็นเฉพาะรายที่เป็นผู้ขายด้วย (ทั้งคู่)
  const custTab = await (await p2.request.get(`/api/contacts?f_role=customer&q=${encodeURIComponent(tag)}`)).json();
  expect(custTab.rows.map((r: { name: string }) => r.name)).toEqual([`ทั้งคู่ ${tag}`]);
  expect((await p2.request.get(`/api/audit?entityType=Contact&entityId=${customer.id}`)).status()).toBe(403);

  // สร้างผู้ติดต่อประเภทลูกค้าไม่ได้
  const cr = await p2.request.post("/api/contacts", { data: contactPayload(`x ${tag}`, { isCustomer: true, isVendor: false }) });
  expect(cr.status()).toBe(403);
  // แก้ไขผู้ติดต่อที่เป็นทั้งคู่ได้ แต่เอาบทบาทลูกค้าออกไม่ได้ และลบไม่ได้
  const ok = await p2.request.patch(`/api/contacts/${both.id}`, { data: { ...contactPayload(`ทั้งคู่ ${tag} (แก้)`, { isCustomer: true, isVendor: true }) } });
  expect(ok.status(), await ok.text()).toBe(200);
  const drop = await p2.request.patch(`/api/contacts/${both.id}`, { data: contactPayload(`ทั้งคู่ ${tag}`, { isCustomer: false, isVendor: true }) });
  expect(drop.status()).toBe(403);
  expect((await p2.request.delete(`/api/contacts/${both.id}`)).status()).toBe(403);
  expect((await p2.request.delete(`/api/contacts/${vendor.id}`)).status()).toBe(200);
  await ctx.close();
});

test("ผู้ที่ไม่มีสิทธิ์ผู้ติดต่อเลย: 403 ทั้งรายการและสร้าง", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const u = await createUserWithPerms(page.request, { permissions: { "purchase.request": { view: true } } });
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, u.email, u.password);
  expect((await p2.request.get("/api/contacts")).status()).toBe(403);
  expect((await p2.request.post("/api/contacts", { data: contactPayload(`x ${uid()}`, { isCustomer: true, isVendor: false }) })).status()).toBe(403);
  expect((await p2.request.post("/api/tags", { data: { name: `x ${uid()}` } })).status()).toBe(403);
  await p2.goto("/contacts");
  await expect(p2).toHaveURL(/\/forbidden/);
  await ctx.close();
});

test("Export CSV ผู้ขาย มี BOM และเฉพาะผู้ขาย", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const tag = uid();
  for (const [name, roles] of [
    [`ผู้ขายซีเอสวี ${tag}`, { isCustomer: false, isVendor: true }],
    [`ลูกค้าซีเอสวี ${tag}`, { isCustomer: true, isVendor: false }],
  ] as const) {
    expect((await page.request.post("/api/contacts", { data: contactPayload(name, roles) })).status()).toBe(200);
  }
  const res = await page.request.get(`/api/contacts?format=csv&f_role=vendor&q=${tag}`);
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = body.toString("utf8");
  expect(text).toContain("เลขประจำตัวผู้เสียภาษี");
  expect(text).toContain(`ผู้ขายซีเอสวี ${tag}`);
  expect(text).not.toContain(`ลูกค้าซีเอสวี ${tag}`);
});
