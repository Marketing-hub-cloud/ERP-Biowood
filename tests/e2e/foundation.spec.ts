import { expect, test } from "@playwright/test";
import { ADMIN, createUserWithPerms, login, loginOk, logout, uid } from "./helpers";

test.beforeAll(() => {
  if (!ADMIN.password) throw new Error("ตั้ง SEED_ADMIN_PASSWORD ใน .env ก่อนรัน e2e");
});

test("ล็อกอินผิดรหัสผ่านต้องแสดงข้อความ", async ({ page }) => {
  await login(page, ADMIN.email, "wrong-password");
  await expect(page.locator("form p[role=alert]")).toHaveText("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
});

test("ยังไม่ล็อกอิน: หน้าเว็บ redirect ไป login และ API ได้ 401", async ({ page, request }) => {
  await page.goto("/users/accounts");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fusers%2Faccounts/);
  const res = await request.get("/api/users");
  expect(res.status()).toBe(401);
});

test("admin เห็นทุกเมนู และสร้างผู้ใช้ผ่านฟอร์มได้", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  for (const label of ["ผู้ติดต่อ", "การขาย (CRM)", "คลังสินค้า", "ถอดแบบ/ติดตั้ง", "จัดซื้อ", "ผู้ใช้งาน", "ตั้งค่า"]) {
    await expect(page.locator("aside").getByRole("button", { name: label })).toBeVisible();
  }

  const id = uid();
  await page.goto("/users/accounts/new");
  await page.locator("#email").fill(`form-${id}@test.local`);
  await page.locator("#firstName").fill("ฟอร์ม");
  await page.locator("#lastName").fill(id);
  await page.locator("#password").fill("Passw0rd!");
  await page.locator("#confirmPassword").fill("Passw0rd!x");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("ยืนยันรหัสผ่านไม่ตรงกัน")).toBeVisible();

  await page.locator("#confirmPassword").fill("Passw0rd!");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page).toHaveURL(/\/users\/accounts\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: `ฟอร์ม ${id}` })).toBeVisible();

  // ประวัติการเปลี่ยนแปลง
  await page.getByRole("button", { name: "ประวัติการเปลี่ยนแปลง" }).click();
  await expect(page.getByTestId("audit-list")).toContainText("สร้าง");
});

test("ไม่มีสิทธิ์ view: เมนูหายจาก sidebar, เปิดหน้าได้ 403, เรียก API ได้ 403", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const u = await createUserWithPerms(page.request, { permissions: { "purchase.request": { view: true, create: true } } });

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, u.email, u.password);

  const aside = p2.locator("aside");
  await expect(aside.locator('[data-menu-key="purchase.request"]')).toBeVisible();
  await expect(aside.locator('[data-menu-key="purchase.order"]')).toHaveCount(0);
  await expect(aside.locator('[data-menu-key="users.account"]')).toHaveCount(0);
  await expect(aside.locator('[data-menu-key="settings.company"]')).toHaveCount(0);
  await expect(aside.locator('[data-menu-key="users.profile"]')).toBeVisible();

  await p2.goto("/users/accounts");
  await expect(p2).toHaveURL(/\/forbidden/);
  await p2.goto("/purchase/orders");
  await expect(p2).toHaveURL(/\/forbidden/);

  for (const url of ["/api/users", "/api/permission-groups", "/api/settings/company", `/api/users/${u.userId}`]) {
    const res = await p2.request.get(url);
    expect(res.status(), url).toBe(403);
  }
  const post = await p2.request.post("/api/users", { data: {} });
  expect(post.status()).toBe(403);
  // แก้ไขสิทธิ์ตัวเองไม่ได้
  const patch = await p2.request.patch(`/api/permission-groups/${u.groupId}`, { data: { name: "x", permissions: {}, memberIds: [] } });
  expect(patch.status()).toBe(403);
  await ctx.close();
});

test("หยุดใช้งาน: ต้องกรอกหมายเหตุ, ล็อกอินไม่ได้ และ session เดิมใช้ไม่ได้ทันที", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const u = await createUserWithPerms(page.request, { permissions: { "users.account": { view: true } } });

  // ผู้ใช้ล็อกอินค้างไว้
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, u.email, u.password);
  expect((await p2.request.get("/api/users")).status()).toBe(200);

  // ไม่มีหมายเหตุ → ไม่ผ่าน
  const bad = await page.request.post(`/api/users/${u.userId}/status`, { data: { status: "INACTIVE", statusNote: "" } });
  expect(bad.status()).toBe(400);

  // admin หยุดใช้งานผ่าน UI
  await page.goto(`/users/accounts/${u.userId}`);
  await page.getByRole("button", { name: "หยุดใช้งาน" }).click();
  await page.getByRole("button", { name: "ยืนยันหยุดใช้งาน" }).click();
  await expect(page.getByText("กรุณากรอกหมายเหตุสถานะ")).toBeVisible();
  await page.locator("#statusNote").fill("ลาออก (e2e)");
  await page.getByRole("button", { name: "ยืนยันหยุดใช้งาน" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("ลาออก (e2e)")).toBeVisible();

  // session เดิมถูกตัดทันที
  expect((await p2.request.get("/api/users")).status()).toBe(401);
  await p2.goto("/");
  await expect(p2).toHaveURL(/\/login/);
  await ctx.close();

  // ล็อกอินใหม่ไม่ได้
  await logout(page);
  await login(page, u.email, u.password);
  await expect(page.locator("form p[role=alert]")).toHaveText("บัญชีนี้ถูกหยุดใช้งาน กรุณาติดต่อผู้ดูแลระบบ");
});

test("admin หยุดใช้งานบัญชีตัวเองไม่ได้", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const users = await (await page.request.get(`/api/users?q=${encodeURIComponent(ADMIN.email)}`)).json();
  const me = users.rows.find((r: { email: string }) => r.email === ADMIN.email);
  const res = await page.request.post(`/api/users/${me.id}/status`, { data: { status: "INACTIVE", statusNote: "test" } });
  expect(res.status()).toBe(400);
});

test("Export CSV มี BOM (Excel อ่านภาษาไทยได้)", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const res = await page.request.get("/api/users?format=csv");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(body.toString("utf8")).toContain("อีเมล");
});

test("ข้อมูลบริษัท: บันทึกได้และมีประวัติ", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  await page.goto("/settings/company");
  const phone = `02-${uid().slice(0, 7)}`;
  await page.locator("#phone").fill(phone);
  await page.locator("#taxId").fill("123");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก")).toBeVisible();
  await page.locator("#taxId").fill("0105555555555");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("บันทึกข้อมูลบริษัทเรียบร้อย")).toBeVisible();
  await page.getByRole("button", { name: "ประวัติการเปลี่ยนแปลง" }).click();
  await expect(page.getByTestId("audit-list")).toContainText(phone);
});
