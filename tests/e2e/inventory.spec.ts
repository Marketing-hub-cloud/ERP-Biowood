import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN, createUserWithPerms, loginOk, uid } from "./helpers";

const LOGO = path.join(process.cwd(), "public", "logo.png");

test("สถานที่จัดเก็บ: สร้างคลัง 4 ระดับได้ ระดับที่ 5 ไม่ได้ / ย้ายโหนด / ลบที่มีลูกไม่ได้", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const id = uid().toUpperCase();
  const create = async (parentId: string | null, code: string) => {
    const r = await page.request.post("/api/inventory/tree/locations", { data: { parentId, code, name: `ที่ ${code}` } });
    return r;
  };

  // สร้างผ่าน UI: คลัง
  await page.goto("/settings/inventory");
  await page.getByRole("button", { name: "เพิ่มคลัง" }).click();
  await page.locator("#tree-code").fill(`${id}-W`);
  await page.locator("#tree-name").fill(`คลังทดสอบ ${id}`);
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText(`คลังทดสอบ ${id}`)).toBeVisible();

  const tree = await (await page.request.get("/api/inventory/tree/locations")).json();
  const wh = tree.find((n: { code: string }) => n.code === `${id}-W`);
  const l1 = await (await create(wh.id, `${id}-1`)).json();
  const l2 = await (await create(l1.id, `${id}-2`)).json();
  const l3 = await (await create(l2.id, `${id}-3`)).json();
  const tooDeep = await create(l3.id, `${id}-4`);
  expect(tooDeep.status()).toBe(400);
  expect((await tooDeep.json()).error).toMatch(/ลึกสุด 4 ระดับ/);

  // รหัสซ้ำในระดับเดียวกันไม่ได้
  expect((await create(wh.id, `${id}-1`)).status()).toBe(409);

  // ย้าย l1 (มีลูก 2 ระดับ) ไปใต้ l2 = ใต้ลูกตัวเอง → ไม่ได้
  const bad = await page.request.patch(`/api/inventory/tree/locations/${l1.id}`, { data: { parentId: l2.id, code: `${id}-1`, name: "x" } });
  expect(bad.status()).toBe(400);
  // ย้าย l2 ขึ้นมาอยู่ใต้คลังโดยตรง → ลูก (l3) เลื่อนระดับตาม
  const mv = await page.request.patch(`/api/inventory/tree/locations/${l2.id}`, { data: { parentId: wh.id, code: `${id}-2`, name: `ที่ ${id}-2` } });
  expect(mv.status(), await mv.text()).toBe(200);
  const after = await (await page.request.get("/api/inventory/tree/locations")).json();
  expect(after.find((n: { id: string }) => n.id === l2.id).level).toBe(1);
  expect(after.find((n: { id: string }) => n.id === l3.id).level).toBe(2);

  // ลบคลังที่มีลูกไม่ได้ ลบใบได้
  expect((await page.request.delete(`/api/inventory/tree/locations/${wh.id}`)).status()).toBe(400);
  expect((await page.request.delete(`/api/inventory/tree/locations/${l3.id}`)).status()).toBe(200);

  // UI แสดง tree ซ้อนกัน
  await page.reload();
  await expect(page.locator('[data-testid="tree-node"]', { hasText: `${id}-2` })).toHaveAttribute("data-level", "1");
});

test("สร้างสินค้าผ่านฟอร์ม: หมวด 3 ระดับ, คุณสมบัติ 3 ชนิด, รูป, แล้วค้นหา/กรอง/Export ได้", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const id = uid();
  const ID = id.toUpperCase();

  // เตรียมหมวด 3 ระดับ + หน่วย + คุณสมบัติ (ผ่าน API ของหน้าตั้งค่า)
  const cat = async (parentId: string | null, name: string) =>
    (await (await page.request.post("/api/inventory/tree/categories", { data: { parentId, name } })).json()).id as string;
  const c1 = await cat(null, `หมวด1 ${id}`);
  const c2 = await cat(c1, `หมวด2 ${id}`);
  const c3 = await cat(c2, `หมวด3 ${id}`);
  const unitRes = await page.request.post("/api/inventory/units", { data: { name: `หน่วย${id}` } });
  expect(unitRes.status()).toBe(200);
  const attr = async (data: object) => {
    const r = await page.request.post("/api/inventory/attributes", { data });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).id as string;
  };
  const aText = await attr({ name: `ขนาด ${id}`, dataType: "TEXT", isRequired: true });
  const aNum = await attr({ name: `ยาว ${id}`, dataType: "NUMBER", unitLabel: "มม." });
  const aSel = await attr({ name: `สี ${id}`, dataType: "SELECT", options: ["แดง", "เขียว"] });

  await page.goto("/inventory/products/new");
  await page.locator("#code").fill(`${ID}-P1`);
  await page.locator("#name").fill(`ไม้ทดสอบ ${id}`);
  // หมวดหมู่ 1/2/3 แบบขึ้นต่อกัน
  for (const [n, name] of [[1, `หมวด1 ${id}`], [2, `หมวด2 ${id}`], [3, `หมวด3 ${id}`]] as const) {
    await page.locator(`#category-${n}`).click();
    await page.getByRole("option", { name }).click();
  }
  // รูป 2 รูป (อัปโหลดหลังบันทึก)
  await page.getByTestId("product-image-input").setInputFiles([LOGO, LOGO]);
  await expect(page.getByTestId("product-image")).toHaveCount(2);

  // ไม่เลือกหน่วย + ไม่กรอกคุณสมบัติบังคับ → ฟ้อง error และสลับแท็บให้
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText("กรุณาเลือกหน่วยสต๊อก")).toBeVisible();
  await page.locator("#stockUnitId").click();
  await page.getByRole("option", { name: `หน่วย${id}` }).click();
  await page.getByRole("tab", { name: /ข้อมูลเฉพาะ/ }).click();
  await page.locator(`#attr-${aNum}`).fill("ยาวมาก");
  await page.getByRole("button", { name: "บันทึก" }).click();
  await expect(page.getByText(`กรุณากรอกขนาด ${id}`)).toBeVisible();
  await expect(page.getByText(`ยาว ${id}ต้องเป็นตัวเลข`)).toBeVisible();
  await page.locator(`#attr-${aText}`).fill("145 x 21");
  await page.locator(`#attr-${aNum}`).fill("2,900");
  await page.locator(`#attr-${aSel}`).click();
  await page.getByRole("option", { name: "เขียว" }).click();
  await page.getByRole("button", { name: "บันทึก" }).click();

  await expect(page).toHaveURL(/\/inventory\/products\/c[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: `${ID}-P1 · ไม้ทดสอบ ${id}` })).toBeVisible();
  await expect(page.getByTestId("product-image")).toHaveCount(2);
  await expect(page.getByText("รูปหลัก", { exact: true })).toHaveCount(1);
  await expect(page.locator("#category-3")).toContainText(`หมวด3 ${id}`);
  await page.getByRole("tab", { name: /ข้อมูลเฉพาะ/ }).click();
  await expect(page.locator(`#attr-${aNum}`)).toHaveValue("2900");

  // รายการ: ค้นหาด้วยค่าคุณสมบัติ + กรองหมวด 1 (รวมหมวดย่อย)
  const list = await (await page.request.get(`/api/products?q=${encodeURIComponent("145 x 21")}&f_category=${c1}`)).json();
  expect(list.rows.map((r: { code: string }) => r.code)).toContain(`${ID}-P1`);
  expect(list.rows[0].category).toBe(`หมวด1 ${id} > หมวด2 ${id} > หมวด3 ${id}`);

  // Export CSV มี BOM + คอลัมน์คุณสมบัติ
  const csv = await page.request.get(`/api/products?format=csv&q=${ID}`);
  const body = await csv.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(body.toString("utf8")).toContain(`ยาว ${id} (มม.)`);

  // ลบหมวด/หน่วย/คุณสมบัติที่สินค้าใช้อยู่ไม่ได้ + ลบตัวเลือกที่ใช้อยู่ไม่ได้
  expect((await page.request.delete(`/api/inventory/tree/categories/${c3}`)).status()).toBe(400);
  expect((await page.request.delete(`/api/inventory/units/${(await unitRes.json()).id}`)).status()).toBe(400);
  expect((await page.request.delete(`/api/inventory/attributes/${aSel}`)).status()).toBe(400);
  const rmOpt = await page.request.patch(`/api/inventory/attributes/${aSel}`, { data: { name: `สี ${id}`, dataType: "SELECT", options: ["แดง"] } });
  expect(rmOpt.status()).toBe(400);
  expect((await rmOpt.json()).error).toMatch(/เขียว/);
  // รหัสสินค้าซ้ำไม่ได้
  const dup = await page.request.post("/api/products", { data: { code: `${ID}-P1`, name: "x", isStockable: false, attributes: { [aText]: "x" } } });
  expect(dup.status()).toBe(409);

  // ลบสินค้า → หายจากรายการ
  await page.getByRole("button", { name: "ลบสินค้า" }).click();
  await page.getByRole("button", { name: "ยืนยันลบ" }).click();
  await expect(page).toHaveURL(/\/inventory\/products$/);
  expect((await (await page.request.get(`/api/products?q=${ID}`)).json()).total).toBe(0);

  // ปิดคุณสมบัติที่สร้างไว้ (ไม่ให้ "บังคับกรอก" ไปกระทบเทสอื่น) — teardown จะลบทิ้งตอนจบ
  for (const [aid, data] of [
    [aText, { name: `ขนาด ${id}`, dataType: "TEXT" }],
    [aNum, { name: `ยาว ${id}`, dataType: "NUMBER", unitLabel: "มม." }],
    [aSel, { name: `สี ${id}`, dataType: "SELECT", options: ["แดง", "เขียว"] }],
  ] as const) {
    expect((await page.request.patch(`/api/inventory/attributes/${aid}`, { data: { ...data, isRequired: false, isActive: false } })).status()).toBe(200);
  }
});

test("สิทธิ์: ดูสินค้าได้อย่างเดียว แก้ไม่ได้ และตั้งค่าคลังได้ 403", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const u = await createUserWithPerms(page.request, { permissions: { "inventory.product": { view: true } } });
  const prod = await page.request.post("/api/products", { data: { code: uid().toUpperCase(), name: `ดูอย่างเดียว ${uid()}`, isStockable: false } });
  expect(prod.status(), await prod.text()).toBe(200);
  const { id: productId } = await prod.json();
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, u.email, u.password);

  await expect(p2.locator('aside [data-menu-key="inventory.product"]')).toBeVisible();
  await expect(p2.locator('aside [data-menu-key="settings.inventory"]')).toHaveCount(0);
  await p2.goto("/settings/inventory");
  await expect(p2).toHaveURL(/\/forbidden/);
  expect((await p2.request.get("/api/inventory/tree/locations")).status()).toBe(403);
  expect((await p2.request.post("/api/inventory/units", { data: { name: `x${uid()}` } })).status()).toBe(403);
  expect((await p2.request.post("/api/products", { data: { code: uid(), name: "x", isStockable: false } })).status()).toBe(403);
  expect((await p2.request.post("/api/lookups", { data: { kind: "PRODUCT_TYPE", label: uid() } })).status()).toBe(403);

  // ดูรายการได้ แต่ไม่มีปุ่มสร้าง และฟอร์มเป็นอ่านอย่างเดียว
  await p2.goto("/inventory/products");
  await expect(p2.getByRole("link", { name: "สร้างสินค้า" })).toHaveCount(0);
  await p2.goto(`/inventory/products/${productId}`);
  await expect(p2.locator("#name")).toBeDisabled();
  await expect(p2.getByRole("button", { name: "บันทึก" })).toHaveCount(0);
  await ctx.close();
});
