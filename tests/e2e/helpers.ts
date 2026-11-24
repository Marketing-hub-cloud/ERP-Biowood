import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@biowood.local",
  password: process.env.SEED_ADMIN_PASSWORD ?? "",
};

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
}

export async function loginOk(page: Page, email: string, password: string) {
  await login(page, email, password);
  await expect(page.getByTestId("user-menu")).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/**
 * id สุ่มที่มี marker "e2e" เสมอ — global-teardown ลบข้อมูลทุกอย่างที่มี marker นี้ในชื่อ/รหัส
 * ดังนั้นข้อมูลที่เทสสร้างต้องใช้ uid() ในชื่อหรือรหัสเสมอ
 */
export function uid() {
  return `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const NO_PERMS = { view: false, create: false, edit: false, delete: false, cancel: false };

/** สร้างกลุ่ม + ผู้ใช้ผ่าน API ด้วย session ของ admin */
export async function createUserWithPerms(
  request: APIRequestContext,
  opts: { permissions: Record<string, Partial<typeof NO_PERMS>>; password?: string },
) {
  const id = uid();
  const password = opts.password ?? "Passw0rd!";
  const permissions = Object.fromEntries(Object.entries(opts.permissions).map(([k, v]) => [k, { ...NO_PERMS, ...v }]));
  const g = await request.post("/api/permission-groups", { data: { name: `E2E-${id}`, description: "e2e", permissions, memberIds: [] } });
  expect(g.status(), await g.text()).toBe(200);
  const { id: groupId } = await g.json();
  const email = `e2e-${id}@test.local`;
  const u = await request.post("/api/users", {
    data: { email, firstName: "ทดสอบ", lastName: id, department: "QA", position: "Tester", password, confirmPassword: password, groupIds: [groupId] },
  });
  expect(u.status(), await u.text()).toBe(200);
  const { id: userId } = await u.json();
  return { email, password, userId, groupId };
}
