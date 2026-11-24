import { expect, test, type Page } from "@playwright/test";
import { ADMIN, createUserWithPerms, loginOk, uid } from "./helpers";

const TODAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

async function setup(page: Page) {
  const id = uid();
  const rq = page.request;
  const unit = await (await rq.post("/api/inventory/units", { data: { name: `ชิ้น${id}` } })).json();
  const product = await (await rq.post("/api/products", { data: { code: `${id.toUpperCase()}-N`, name: `สินค้า ${id}`, isStockable: true, stockUnitId: unit.id, attributes: {} } })).json();
  const admin = (await (await rq.get(`/api/users?q=${encodeURIComponent(ADMIN.email)}`)).json()).rows[0];
  return { id, productId: product.id as string, adminId: admin.id as string };
}

const createPr = async (page: Page, c: { id: string; productId: string; adminId: string }) => {
  const r = await page.request.post("/api/purchase/requests", {
    data: { docDate: TODAY, requesterId: c.adminId, reference: `e2e ${c.id}`, lines: [{ productId: c.productId, quantity: 2 }] },
  });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as { id: string; docNo: string };
};

test("กระดิ่ง: ผู้อนุมัติได้แจ้งเตือน → กดแล้วเปิดเอกสาร/อ่านแล้ว → ไม่อนุมัติ → ผู้สร้างได้แจ้งเตือน", async ({ page, browser }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);
  const approver = await createUserWithPerms(page.request, { permissions: { "purchase.request": { view: true, edit: true } } });
  // ผังอนุมัติ PR: ลำดับ 1 = ผู้อนุมัติ (global-teardown คืนค่าผังเดิมให้)
  expect((await page.request.put("/api/settings/approval/PR", { data: { steps: [[approver.userId]] } })).status()).toBe(200);
  const pr = await createPr(page, c);
  expect((await page.request.post(`/api/purchase/requests/${pr.id}/actions`, { data: { action: "submit" } })).status()).toBe(200);

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, approver.email, approver.password);
  await expect(p2.getByTestId("notification-badge")).toHaveText("1");
  await p2.getByTestId("notification-bell").click();
  const item = p2.getByTestId("notification-list").getByRole("button", { name: new RegExp(`${pr.docNo} รออนุมัติจากคุณ`) });
  await expect(item).toHaveAttribute("data-unread", "yes");
  await item.click();
  await expect(p2).toHaveURL(new RegExp(`/purchase/requests/${pr.id}$`));
  await expect(p2.getByTestId("notification-badge")).toHaveCount(0);

  // ไม่อนุมัติ → ผู้สร้าง (admin) ได้แจ้งเตือน
  await p2.getByRole("button", { name: "ไม่อนุมัติ" }).click();
  await p2.locator("#actionComment").fill(`จำนวนไม่ถูก ${c.id}`);
  await p2.getByRole("button", { name: "ยืนยันไม่อนุมัติ" }).click();
  await expect(p2.getByTestId("status-stepper").getByText("ร่าง", { exact: true })).toHaveAttribute("aria-current", "step");
  await ctx.close();

  await page.goto("/notifications");
  const row = page.getByTestId("notification-row").filter({ hasText: `${pr.docNo} ไม่อนุมัติ` });
  await expect(row).toHaveAttribute("data-unread", "yes");
  await expect(row).toContainText(`เหตุผล: จำนวนไม่ถูก ${c.id}`);
  // ผู้กดเองไม่ได้แจ้งเตือนของตัวเอง: admin กดส่ง จึงไม่มี "รออนุมัติจากคุณ" ของใบนี้
  await expect(page.getByTestId("notification-row").filter({ hasText: `${pr.docNo} รออนุมัติจากคุณ` })).toHaveCount(0);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/purchase/requests/${pr.id}$`));
});

test("ตั้งค่า LINE: เปิดใช้ + groupId → เอกสารใหม่เข้าคิว (ยังไม่ตั้ง token = รอส่ง) + ทดสอบส่ง + ส่งซ้ำ", async ({ page }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);
  const groupId = `Ce2e${c.id}`.slice(0, 33);

  await page.goto("/settings/notifications");
  const card = page.getByTestId("notify-purchase");
  const sw = card.getByRole("switch");
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  await card.locator("#group-purchase").click();
  await page.getByRole("option", { name: "กรอก groupId เอง" }).click();
  await card.getByLabel("groupId จัดซื้อ").fill("bad id!");
  await card.getByRole("button", { name: "บันทึก" }).click();
  await expect(card.getByText(/groupId ไม่ถูกต้อง/)).toBeVisible();
  await card.getByLabel("groupId จัดซื้อ").fill(groupId);
  await card.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("บันทึกการแจ้งเตือนจัดซื้อแล้ว")).toBeVisible();

  const settings = await (await page.request.get("/api/settings/notifications")).json();
  const purchase = settings.modules.find((m: { module: string }) => m.module === "purchase");
  expect(purchase).toMatchObject({ lineEnabled: true, lineGroupId: groupId });

  // เอกสารใหม่ → คิว LINE ข้อความมีเลขที่ สถานะ ผู้ทำ ลิงก์
  const pr = await createPr(page, c);
  const q = await (await page.request.get(`/api/settings/notifications?view=deliveries&q=${pr.docNo}`)).json();
  expect(q.rows).toHaveLength(1);
  expect(q.rows[0].target).toBe(groupId);
  expect(q.rows[0].message).toContain(`[จัดซื้อ] สร้างเอกสาร ใบขอซื้อ ${pr.docNo}`);
  expect(q.rows[0].message).toContain("สถานะ: ร่าง");
  expect(q.rows[0].message).toMatch(new RegExp(`/purchase/requests/${pr.id}$`));
  if (!settings.tokenConfigured) {
    expect(q.rows[0].status).toBe("PENDING");
    await expect(page.getByTestId("env-LINE_CHANNEL_ACCESS_TOKEN")).toContainText("ยังไม่ได้ตั้ง");
  }

  // ทดสอบส่ง + ประวัติ
  await page.reload();
  await page.getByTestId("notify-purchase").getByRole("button", { name: "ทดสอบส่ง" }).click();
  await expect(page.getByText(/เข้าคิว/).first()).toBeVisible();
  await page.getByLabel("ค้นหา").fill(pr.docNo);
  await expect(page.getByTestId("delivery-status").first()).toBeVisible();
  const test1 = await (await page.request.get(`/api/settings/notifications?view=deliveries&q=${encodeURIComponent("ทดสอบการแจ้งเตือน")}`)).json();
  expect(test1.rows.some((r: { target: string }) => r.target === groupId)).toBe(true);

  // ส่งซ้ำรายการที่ยังไม่สำเร็จ
  if (q.rows[0].status !== "SENT") {
    expect((await page.request.post(`/api/settings/notifications/deliveries/${q.rows[0].id}/retry`)).status()).toBe(200);
  }

  // ปิด LINE → เอกสารใหม่ไม่เข้าคิว
  expect((await page.request.put("/api/settings/notifications", { data: { module: "purchase", lineEnabled: false, lineGroupId: groupId } })).status()).toBe(200);
  const pr2 = await createPr(page, c);
  const q2 = await (await page.request.get(`/api/settings/notifications?view=deliveries&q=${pr2.docNo}`)).json();
  expect(q2.rows).toHaveLength(0);
});

test("สิทธิ์และความปลอดภัย: ตั้งค่าแจ้งเตือน 403, webhook ต้องมีลายเซ็น, job ต้องมี secret, อ่านแจ้งเตือนได้เฉพาะของตัวเอง", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const u = await createUserWithPerms(page.request, { permissions: { "purchase.request": { view: true } } });
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, u.email, u.password);
  await expect(p2.locator('aside [data-menu-key="settings.notification"]')).toHaveCount(0);
  expect((await p2.request.get("/api/settings/notifications")).status()).toBe(403);
  expect((await p2.request.put("/api/settings/notifications", { data: { module: "purchase", lineEnabled: false } })).status()).toBe(403);
  expect((await p2.request.post("/api/settings/notifications/test", { data: { module: "purchase" } })).status()).toBe(403);
  await p2.goto("/settings/notifications");
  await expect(p2).toHaveURL(/\/forbidden/);
  // เปิดเอกสารที่ไม่มีอยู่ (เช่น ลิงก์จากแจ้งเตือนเก่า) → หน้า "ไม่พบเอกสาร" ภาษาไทย ไม่ใช่ 404 เปล่า
  await p2.goto("/purchase/requests/does-not-exist");
  await expect(p2.getByTestId("not-found")).toContainText("ไม่พบเอกสารหรือหน้าที่ต้องการ");
  await expect(p2.getByTestId("user-menu")).toBeVisible();

  // แจ้งเตือนของ admin อ่านแทนไม่ได้ (updateMany กรองตาม userId)
  const adminItems = (await (await page.request.get("/api/notifications?limit=5")).json()).items as { id: string }[];
  if (adminItems.length) {
    const r = await (await p2.request.post("/api/notifications/read", { data: { ids: adminItems.map((x) => x.id) } })).json();
    expect(r.updated).toBe(0);
  }
  expect((await p2.request.get("/api/notifications")).status()).toBe(200);
  await ctx.close();

  // webhook / job ไม่ต้องล็อกอิน แต่ต้องยืนยันตัวตน
  const anon = await browser.newContext();
  expect((await anon.request.post("/api/line/webhook", { data: { events: [] }, headers: { "x-line-signature": "bad" } })).status()).toBe(401);
  expect((await anon.request.post("/api/jobs/notifications")).status()).toBe(401);
  expect((await anon.request.get("/api/notifications")).status()).toBe(401);
  await anon.close();
});
