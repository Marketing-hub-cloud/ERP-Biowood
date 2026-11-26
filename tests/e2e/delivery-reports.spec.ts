import { expect, test, type Page } from "@playwright/test";
import { ADMIN, createUserWithPerms, loginOk, uid } from "./helpers";

const TODAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** คลัง + สินค้า + ใบนำเข้า 1 SN × 10 + ใบนำออก (ร่าง) ที่มีที่อยู่จัดส่ง — ผ่าน API ของ admin */
async function issueFixture(page: Page) {
  const id = uid();
  const ID = id.toUpperCase();
  const post = async (url: string, data?: object) => {
    const r = await page.request.post(url, { data });
    expect(r.status(), `${url} ${await r.text()}`).toBe(200);
    return r.json();
  };
  const { id: whId } = await post("/api/inventory/tree/locations", { parentId: null, code: `${ID}-W`, name: `คลัง ${id}` });
  const { id: unitId } = await post("/api/inventory/units", { name: `แผ่น${id}` });
  const { id: productId } = await post("/api/products", { code: `${ID}-P`, name: `ไม้พื้น ${id}`, isStockable: true, stockUnitId: unitId, attributes: {} });
  const gr = await post("/api/inventory/receipts", { type: "OTHER", docDate: TODAY, warehouseId: whId, lines: [{ productId, locationId: whId }] });
  const detail = await (await page.request.get(`/api/inventory/receipts/${gr.id}`)).json();
  await post(`/api/inventory/receipts/${gr.id}/lines/${detail.lines[0].id}/serials`, { count: 1, qtyPerSerial: 10 });
  await post(`/api/inventory/receipts/${gr.id}/scan`, { barcode: `${gr.docNo}-001` });
  await post(`/api/inventory/receipts/${gr.id}/post`);
  const serial = await (await page.request.get(`/api/inventory/serials/lookup?barcode=${gr.docNo}-001`)).json();
  const gi = await post("/api/inventory/issues", {
    type: "OTHER",
    docDate: TODAY,
    recipientName: `ผู้รับ ${id}`,
    shippingAddress: `99/1 ถนน ${id} กรุงเทพมหานคร`,
    note: `ส่งของ ${id}`,
    lines: [{ serialId: serial.serialId, quantity: 3 }],
    post: true,
  });
  const giDetail = await (await page.request.get(`/api/inventory/issues/${gi.id}`)).json();
  return { id, productCode: `${ID}-P`, issueId: gi.id as string, issueNo: giDetail.docNo as string };
}

test("ตารางงานพนักงานส่ง: สร้างจากใบนำออก → ปฏิทิน เดือน/สัปดาห์/วัน → พนักงานส่งกด 'ส่งแล้ว'", async ({ page, browser }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const f = await issueFixture(page);
  const driver = await createUserWithPerms(page.request, { permissions: { "inventory.delivery": { view: true }, "inventory.issue": { view: true } } });

  // หน้าใบนำออก → การ์ด "งานจัดส่ง" → สร้าง
  await page.goto(`/inventory/issues/${f.issueId}`);
  const card = page.getByTestId("issue-deliveries");
  await expect(card).toContainText("ยังไม่มีงานจัดส่ง");
  await card.getByRole("link", { name: "สร้างงานจัดส่ง" }).click();
  await expect(page).toHaveURL(/\/inventory\/deliveries\/new\?issue=/);
  await expect(page.locator("#goodsIssueId")).toContainText(f.issueNo);
  await expect(page.locator("#goodsIssueId")).toBeDisabled();
  await expect(page.locator("#shippingAddress")).toHaveValue(new RegExp(`99/1 ถนน ${f.id}`));
  await page.locator("#driverId").click();
  await page.getByLabel("ค้นหา").fill(driver.email.split("@")[0].slice(4));
  await page.getByRole("option").first().click();
  // ลิงก์ไม่ถูกต้อง → error
  await page.locator("#mapUrl").fill("ไม่ใช่ลิงก์");
  await page.getByRole("button", { name: "สร้างงานจัดส่ง" }).click();
  await expect(page.getByText(/กรอกลิงก์ Google Map/).first()).toBeVisible();
  await page.locator("#mapUrl").fill("13.7563,100.5018");
  await page.getByRole("button", { name: "สร้างงานจัดส่ง" }).click();
  await expect(page).toHaveURL(/\/inventory\/deliveries\/(?!new)[a-z0-9]+$/);
  const jobId = page.url().split("/").pop()!;
  await expect(page.getByText("นัดส่ง").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /เปิด Google Map/ })).toHaveAttribute("href", "https://www.google.com/maps?q=13.7563,100.5018");

  // ใบนำออกแสดงงานจัดส่ง
  await page.goto(`/inventory/issues/${f.issueId}`);
  await expect(page.getByTestId("issue-deliveries")).toContainText("นัดส่ง");

  // ปฏิทิน: เดือน → สัปดาห์ → วัน (กรองพนักงานส่ง)
  await page.goto("/inventory/deliveries");
  const cal = page.getByTestId("schedule-calendar");
  await expect(cal).toHaveAttribute("data-view", "month");
  await page.getByLabel("กรองพนักงานจัดส่ง").click();
  await page.getByRole("option", { name: new RegExp(driver.email.split("@")[0].slice(4)) }).click();
  const event = cal.locator(`[data-day="${TODAY}"]`).getByRole("link", { name: new RegExp(f.issueNo) });
  await expect(event.first()).toBeVisible();
  await cal.getByRole("button", { name: "สัปดาห์" }).click();
  await expect(cal).toHaveAttribute("data-view", "week");
  await expect(cal.locator(`[data-day="${TODAY}"]`).getByRole("link", { name: new RegExp(f.issueNo) })).toContainText("09:00–12:00");
  await cal.getByRole("button", { name: "วัน", exact: true }).click();
  await expect(cal).toHaveAttribute("data-view", "day");
  await expect(cal.getByRole("link", { name: new RegExp(f.issueNo) })).toContainText(`99/1 ถนน ${f.id}`);
  await cal.getByRole("button", { name: "ถัดไป" }).click();
  await expect(cal.getByText("ไม่มีงานในวันนี้")).toBeVisible();

  // รายการ + Export CSV
  await page.getByRole("tab", { name: "รายการ" }).click();
  await page.getByPlaceholder(/ค้นหาใบนำออก/).fill(f.issueNo);
  await expect(page.getByRole("row", { name: new RegExp(f.issueNo) })).toBeVisible();
  const csv = await page.request.get(`/api/inventory/deliveries?format=csv&q=${f.issueNo}`);
  const text = await csv.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("พนักงานจัดส่ง");
  expect(text).toContain(f.issueNo);

  // พนักงานส่ง: เห็นเมนูตารางงาน แต่ไม่เห็นนำเข้า, แก้ไขงานไม่ได้ (403), กด "ส่งแล้ว" ได้
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, driver.email, driver.password);
  const aside = p2.locator("aside");
  await expect(aside.locator('[data-menu-key="inventory.delivery"]')).toBeVisible();
  await expect(aside.locator('[data-menu-key="inventory.receipt"]')).toHaveCount(0);
  const patch = await p2.request.patch(`/api/inventory/deliveries/${jobId}`, {
    data: { goodsIssueId: f.issueId, startAt: `${TODAY}T09:00`, endAt: `${TODAY}T12:00`, driverId: driver.userId },
  });
  expect(patch.status()).toBe(403);
  expect((await p2.request.post("/api/inventory/deliveries", { data: {} })).status()).toBe(403);
  await p2.goto(`/inventory/deliveries/${jobId}`);
  await expect(p2.getByRole("button", { name: "ยกเลิกงาน" })).toHaveCount(0);
  await p2.getByRole("button", { name: "ส่งแล้ว" }).click();
  await p2.getByRole("button", { name: "ยืนยัน" }).click();
  await expect(p2.getByText(/^ส่งแล้ว \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await expect(p2.getByRole("button", { name: "ส่งแล้ว" })).toHaveCount(0);
  await ctx.close();

  // ประวัติ: สร้าง + เปลี่ยนสถานะ
  const audit = await (await page.request.get(`/api/audit?entityType=DeliveryJob&entityId=${jobId}`)).json();
  expect(JSON.stringify(audit)).toContain("STATUS_CHANGE");
});

test("รายงาน: ทุกรายงานของ 3 โมดูลเปิดได้, กรองได้, Export CSV เป็น UTF-8 BOM; ไม่มีสิทธิ์ = 403", async ({ page, browser }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const f = await issueFixture(page);

  for (const href of ["/crm/reports", "/inventory/reports", "/purchase/reports"]) {
    await page.goto(href);
    const links = page.getByRole("navigation", { name: "รายการรายงาน" }).getByRole("link");
    const n = await links.count();
    expect(n, href).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < n; i++) {
      await links.nth(i).click();
      await expect(links.nth(i)).toHaveAttribute("aria-current", "page");
      await expect(page.getByText(/^ทั้งหมด [\d,]+ แถว/)).toBeVisible();
      await expect(page.getByTestId("report-table")).toBeVisible();
    }
  }

  // ยอดคงคลังของสินค้าเทส = 10 − 3
  await page.goto("/inventory/reports?r=on-hand");
  await page.locator("#rf-view").click();
  await page.getByRole("option", { name: "รวมต่อสินค้า" }).click();
  await expect(page.getByTestId("report-table").getByRole("row", { name: new RegExp(f.productCode) })).toContainText("7");

  // stock card ของสินค้าเทส: รับ 10 จ่าย 3 คงเหลือ 7
  await page.goto("/inventory/reports?r=stock-card");
  await page.locator("#rf-product").click();
  await page.getByLabel("ค้นหา").fill(f.productCode);
  await page.getByRole("option", { name: new RegExp(f.productCode) }).click();
  const last = page.getByTestId("report-table").getByRole("row", { name: /ยอดคงเหลือ/ });
  await expect(last).toContainText("10");
  await expect(last).toContainText("3");
  await expect(last).toContainText("7");

  // Export CSV จากปุ่ม
  const href = await page.getByTestId("report-export").getAttribute("href");
  expect(href).toContain("format=csv");
  const res = await page.request.get(href!);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const text = await res.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("รหัสสินค้า");
  expect(text).toContain(f.productCode);

  // ไม่มีสิทธิ์รายงาน CRM: เมนูหาย หน้า 403 API 403 แต่รายงานคลังได้
  const u = await createUserWithPerms(page.request, { permissions: { "inventory.report": { view: true } } });
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, u.email, u.password);
  await expect(p2.locator("aside").locator('[data-menu-key="crm.report"]')).toHaveCount(0);
  await p2.goto("/crm/reports");
  await expect(p2).toHaveURL(/\/forbidden/);
  expect((await p2.request.get("/api/reports/crm/projects")).status()).toBe(403);
  expect((await p2.request.get("/api/reports/purchase/orders?format=csv")).status()).toBe(403);
  expect((await p2.request.get("/api/reports/inventory/on-hand")).status()).toBe(200);
  expect((await p2.request.get("/api/reports/inventory/nope")).status()).toBe(404);
  await ctx.close();
});
