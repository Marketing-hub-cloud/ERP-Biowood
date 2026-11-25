import { devices, expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, createUserWithPerms, loginOk, uid } from "./helpers";

type Json = { id: string; [k: string]: unknown };
async function ok(r: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<Json> {
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as Json;
}

const TODAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

async function customer(page: Page, id: string) {
  return ok(
    await page.request.post("/api/contacts", {
      data: {
        isCustomer: true,
        isVendor: false,
        entityType: "INDIVIDUAL",
        name: `ลูกค้า ${id}`,
        reg: { address: "1 ถนนพระราม 9", province: "กรุงเทพมหานคร" },
        shippingAddresses: [],
        channels: [],
        persons: [{ name: `คุณติดต่อ ${id}`, position: "เจ้าของบ้าน", phone: "0812345678", isPrimary: true }],
        tagIds: [],
      },
    }),
  );
}

/** Haversine (ใช้ตรวจค่าที่แสดง) */
function km(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

test("โครงการ: สร้างผ่านฟอร์ม → เปลี่ยนสถานะ (การเคลื่อนไหว) → สร้างใบถอดแบบจากโครงการ → จำนวนโครงการของลูกค้า", async ({ page }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const id = uid();
  await customer(page, id);

  await page.goto("/crm/projects/new");
  await page.locator("#name").fill(`บ้านคุณบี ${id}`);
  await page.locator("#customerId").click();
  await page.getByLabel("ค้นหาผู้ติดต่อ").fill(id);
  await page.getByRole("option", { name: new RegExp(id) }).click();
  // เลือกบุคคลติดต่อจากผู้ติดต่อ
  await page.getByLabel("เลือกบุคคลติดต่อ").click();
  await page.getByRole("option", { name: new RegExp(`คุณติดต่อ ${id}`) }).click();
  await expect(page.locator("#contactPerson")).toHaveValue(/เจ้าของบ้าน.*0812345678/);
  await page.locator("#probability").click();
  await page.getByRole("option", { name: "70%" }).click();
  await page.locator("#value").fill("192085");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page).toHaveURL(/\/crm\/projects\/(?!new)[a-z0-9]+$/);
  const projectId = page.url().split("/").pop()!;
  const stepper = page.getByTestId("project-stepper");
  await expect(stepper.locator('[aria-current="step"]')).toHaveText("โครงการใหม่");

  // เปลี่ยนสถานะผ่าน dropdown แล้วบันทึก
  await page.locator("#status").click();
  await page.getByRole("option", { name: "เสนอราคา" }).click();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(stepper.locator('[aria-current="step"]')).toHaveText("เสนอราคา");
  await page.getByRole("tab", { name: "การเคลื่อนไหว" }).click();
  await expect(page.getByTestId("audit-list").getByText("เปลี่ยนสถานะ: โครงการใหม่ → เสนอราคา")).toBeVisible();
  await expect(page.getByRole("button", { name: "สร้างใบเสนอราคา" })).toBeDisabled();

  // สร้างใบถอดแบบ: ดึงลูกค้าและชื่อโครงการมาให้
  await page.getByRole("link", { name: "สร้างใบถอดแบบ" }).click();
  await expect(page).toHaveURL(/\/engineer\/documents\/new\?project=/);
  await expect(page.locator("#projectName")).toHaveValue(`บ้านคุณบี ${id}`);
  await expect(page.getByTestId("customer-box")).toContainText(`ลูกค้า ${id}`);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page).toHaveURL(/\/engineer\/documents\/(?!new)[a-z0-9]+$/);
  await page.goto(`/crm/projects/${projectId}`);
  await expect(page.getByTestId("project-engineer-docs").getByRole("link")).toHaveText(/^EN\d{10}$/);

  // หน้าผู้ติดต่อ: จำนวนโครงการ
  const contacts = await (await page.request.get(`/api/contacts?q=${id}`)).json();
  expect(contacts.rows[0].projectCount).toBe(1);
  // CSV โครงการมี BOM + ภาษาไทย
  const csv = await (await page.request.get(`/api/crm/projects?format=csv&q=${id}`)).body();
  expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(csv.toString("utf8")).toContain("เสนอราคา");
});

test("แผนการทำงานบนมือถือ: เช็คอินจุดเริ่มต้น/จุดหมายด้วย GPS และระยะทางถูกต้อง", async ({ page, browser }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const id = uid();
  const c = await customer(page, id);
  const sales = await createUserWithPerms(page.request, { permissions: { "crm.plan": { view: true, create: true }, "contacts.customer": { view: true } } });

  const start = { latitude: 13.7563, longitude: 100.5018 };
  const end = { latitude: 13.8199, longitude: 100.5603 };
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "th-TH", timezoneId: "Asia/Bangkok", permissions: ["geolocation"], geolocation: start });
  const m = await ctx.newPage();
  await loginOk(m, sales.email, sales.password);

  // สร้างแผนผ่านฟอร์มบนมือถือ
  await m.goto("/crm/plans/new");
  await m.locator("#subject").fill(`เยี่ยมหน้างาน ${id}`);
  await m.locator("#location").fill("หมู่บ้านไม้งาม");
  await m.locator("#customerId").click();
  await m.getByLabel("ค้นหาผู้ติดต่อ").fill(id);
  await m.getByRole("option", { name: new RegExp(id) }).click();
  await m.getByRole("button", { name: "สร้างแผน" }).click();
  await expect(m).toHaveURL(/\/crm\/plans\/(?!new)[a-z0-9]+$/);
  const planId = m.url().split("/").pop()!;
  await expect(m.getByText("วางแผน", { exact: true })).toBeVisible();

  await m.getByRole("button", { name: "เช็คอิน จุดเริ่มต้น" }).click();
  await expect(m.getByText("เช็คอิน", { exact: true }).first()).toBeVisible();
  await expect(m.getByRole("link", { name: /13\.756300, 100\.501800/ })).toBeVisible();

  await ctx.setGeolocation(end);
  await m.getByRole("button", { name: "เช็คอิน จุดหมาย" }).click();
  const expected = km(start, end);
  await expect(m.getByTestId("plan-distance")).toHaveText(`${expected.toFixed(2)} กม.`);
  await expect(m.getByText("เสร็จสิ้น", { exact: true }).first()).toBeVisible();
  await expect(m.getByTestId("checkin-panel")).toHaveCount(0);
  await ctx.close();

  // แผนที่เสร็จสิ้นแล้วเช็คอินซ้ำไม่ได้ (409); รายการ/ปฏิทิน/CSV
  const r = await page.request.post(`/api/crm/plans/${planId}/actions`, { data: { action: "checkin_start", lat: 1, lng: 1 } });
  expect(r.status()).toBe(409);
  const detail = await (await page.request.get(`/api/crm/plans/${planId}`)).json();
  expect(Number(detail.distanceKm)).toBeCloseTo(expected, 2);
  expect(detail.customerId).toBe(c.id);
  await page.goto("/crm/plans");
  await page.getByPlaceholder(/ค้นหาเรื่อง/).fill(id);
  await expect(page.getByRole("row", { name: new RegExp(`เยี่ยมหน้างาน ${id}`) })).toContainText("เสร็จสิ้น");
  await page.getByRole("tab", { name: "ปฏิทิน" }).click();
  await expect(page.getByTestId("month-calendar").locator(`[data-day="${TODAY}"]`).getByRole("link", { name: new RegExp(id) })).toBeVisible();
  const csv = (await (await page.request.get(`/api/crm/plans?format=csv&q=${id}`)).body()).toString("utf8");
  expect(csv).toContain(expected.toFixed(3));
});

test("สิทธิ์ CRM: ไม่มี view = ไม่เห็นเมนู + API 403; คนอื่นเช็คอินแผนของเราไม่ได้", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const id = uid();
  const none = await createUserWithPerms(page.request, { permissions: { "contacts.customer": { view: true } } });
  const viewer = await createUserWithPerms(page.request, { permissions: { "crm.plan": { view: true } } });
  const users = await (await page.request.get(`/api/users?q=${encodeURIComponent(ADMIN.email)}`)).json();
  const plan = await ok(
    await page.request.post("/api/crm/plans", {
      data: { subject: `แผน ${id}`, plannedStart: `${TODAY}T09:00`, plannedEnd: `${TODAY}T10:00`, employeeId: users.rows[0].id },
    }),
  );

  const c1 = await browser.newContext();
  const p1 = await c1.newPage();
  await loginOk(p1, none.email, none.password);
  await expect(p1.getByRole("link", { name: "โครงการ" })).toHaveCount(0);
  await expect(p1.getByRole("link", { name: "แผนการทำงาน" })).toHaveCount(0);
  expect((await p1.request.get("/api/crm/projects")).status()).toBe(403);
  expect((await p1.request.get("/api/crm/plans")).status()).toBe(403);
  expect((await p1.request.post("/api/crm/projects", { data: {} })).status()).toBe(403);
  await c1.close();

  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await loginOk(p2, viewer.email, viewer.password);
  const r = await p2.request.post(`/api/crm/plans/${plan.id}/actions`, { data: { action: "checkin_start", lat: 13.7, lng: 100.5 } });
  expect(r.status()).toBe(403);
  expect((await p2.request.post("/api/crm/plans", { data: {} })).status()).toBe(403);
  await p2.goto(`/crm/plans/${plan.id}`);
  await expect(p2.getByTestId("checkin-panel")).toHaveCount(0);
  await c2.close();
});
