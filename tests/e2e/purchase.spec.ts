import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN, createUserWithPerms, loginOk, uid } from "./helpers";

const TODAY = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

type Ctx = { id: string; ID: string; productId: string; productCode: string; vendorId: string; vendorName: string; whId: string; locId: string; adminId: string };

type Json = { id: string; docNo: string; [k: string]: unknown };
async function ok(r: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<Json> {
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as Json;
}

/** สินค้า + ผู้ขาย + คลัง ของเทสเอง (ผ่าน API ของ admin) */
async function setup(page: Page): Promise<Ctx> {
  const id = uid();
  const ID = id.toUpperCase();
  const rq = page.request;
  const unit = await ok(await rq.post("/api/inventory/units", { data: { name: `แผ่น${id}` } }));
  const productCode = `${ID}-WOOD`;
  const product = await ok(await rq.post("/api/products", { data: { code: productCode, name: `ไม้ ${id}`, isStockable: true, stockUnitId: unit.id, attributes: {} } }));
  const vendorName = `ผู้ขาย ${id}`;
  const vendor = await ok(
    await rq.post("/api/contacts", {
      data: { isCustomer: false, isVendor: true, entityType: "JURISTIC", name: vendorName, reg: {}, shippingAddresses: [], channels: [], persons: [], tagIds: [] },
    }),
  );
  const wh = await ok(await rq.post("/api/inventory/tree/locations", { data: { parentId: null, code: `${ID}-W`, name: `คลัง ${id}` } }));
  const loc = await ok(await rq.post("/api/inventory/tree/locations", { data: { parentId: wh.id, code: `${ID}-A`, name: `โซน ${id}` } }));
  const users = await (await rq.get(`/api/users?q=${encodeURIComponent(ADMIN.email)}`)).json();
  return { id, ID, productId: product.id, productCode, vendorId: vendor.id, vendorName, whId: wh.id, locId: loc.id, adminId: users.rows[0].id };
}

const act = (rq: APIRequestContext, kind: string, id: string, action: string, comment?: string) =>
  rq.post(`/api/purchase/${kind}/${id}/actions`, { data: { action, comment } });

async function approvedOrder(page: Page, c: Ctx, qty: number, unitPrice = 1250) {
  const po = await ok(
    await page.request.post("/api/purchase/orders", {
      data: { docDate: TODAY, vendorId: c.vendorId, warehouseId: c.whId, note: `e2e ${c.id}`, lines: [{ productId: c.productId, quantity: qty, unitPrice }] },
    }),
  );
  await ok(await act(page.request, "orders", po.id, "submit"));
  await ok(await act(page.request, "orders", po.id, "approve"));
  return po as { id: string; docNo: string };
}

/** ใบนำเข้าจาก PO ผ่าน API (สร้าง SN, สแกน) — post=false คืนใบร่าง */
async function receiveFromOrder(page: Page, c: Ctx, poId: string, qty: number, post = true) {
  const rq = page.request;
  const opts = await (await rq.get(`/api/purchase/orders/options?purpose=receipt&id=${poId}`)).json();
  const ol = opts.lines[0];
  const gr = await ok(
    await rq.post("/api/inventory/receipts", {
      data: { type: "PURCHASE", purchaseOrderId: poId, docDate: TODAY, warehouseId: c.whId, lines: [{ productId: c.productId, orderLineId: ol.orderLineId, locationId: c.locId }] },
    }),
  );
  const detail = await (await rq.get(`/api/inventory/receipts/${gr.id}`)).json();
  await ok(await rq.post(`/api/inventory/receipts/${gr.id}/lines/${detail.lines[0].id}/serials`, { data: { count: 1, qtyPerSerial: qty } }));
  await ok(await rq.post(`/api/inventory/receipts/${gr.id}/scan`, { data: { barcode: `${gr.docNo}-001` } }));
  if (post) await ok(await rq.post(`/api/inventory/receipts/${gr.id}/post`));
  return gr as { id: string; docNo: string };
}

const onHand = async (page: Page, code: string) => (await (await page.request.get(`/api/products?q=${code}`)).json()).rows[0].onHand as number;
const docStatus = async (page: Page, kind: string, id: string) => (await (await page.request.get(`/api/purchase/${kind}/${id}`)).json()).status as string;

async function pickProduct(page: Page, trigger: string, code: string) {
  await page.locator(trigger).click();
  await page.getByLabel("ค้นหา", { exact: true }).fill(code);
  await page.getByRole("option", { name: new RegExp(code) }).click();
}

test("PR 10 → PO 6 = สั่งซื้อแล้วบางส่วน → PO 4 = สั่งซื้อแล้ว (สร้างผ่านฟอร์ม + สูตรราคา)", async ({ page }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);

  // ใบขอซื้อผ่านฟอร์ม
  await page.goto("/purchase/requests/new");
  await pickProduct(page, "#product-0", c.productCode);
  await page.getByLabel("จำนวน รายการที่ 1").fill("10");
  await page.locator("#reference").fill(`e2e ${c.id}`);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page).toHaveURL(/\/purchase\/requests\/(?!new)[a-z0-9]+$/);
  const prId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "ส่งอนุมัติ" }).click();
  await expect(page.getByTestId("status-stepper").getByText("รออนุมัติ", { exact: true })).toHaveAttribute("aria-current", "step");
  // ไม่มีผังอนุมัติ → admin (มีสิทธิ์อนุมัติ) กดอนุมัติได้
  await page.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันอนุมัติ" }).click();
  await expect(page.getByTestId("status-stepper").getByText("อนุมัติแล้ว", { exact: true })).toHaveAttribute("aria-current", "step");

  // สร้าง > ใบสั่งซื้อ (ดึงคงค้าง 10 มาให้) → แก้เป็น 6
  await page.getByRole("link", { name: /สร้าง > ใบสั่งซื้อ/ }).click();
  await expect(page.getByLabel("จำนวน รายการที่ 1")).toHaveValue("10");
  await page.getByLabel("จำนวน รายการที่ 1").fill("6");
  await page.getByLabel("ราคาต่อหน่วย รายการที่ 1").fill("1,250");
  await page.getByLabel("ส่วนลด รายการที่ 1").fill("500");
  // 6 × 1,250 − 500 = 7,000 → VAT 490 → 7,490
  await expect(page.getByTestId("line-amount").first()).toHaveText("7,000.00");
  await expect(page.getByTestId("po-vat")).toHaveText("490.00");
  await expect(page.getByTestId("po-total")).toHaveText("7,490.00");
  await page.locator("#vendorId").click();
  await page.getByLabel("ค้นหาผู้ติดต่อ").fill(c.id);
  await page.getByRole("option", { name: new RegExp(c.vendorName) }).click();
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page).toHaveURL(/\/purchase\/orders\/(?!new)[a-z0-9]+$/);
  const po1 = page.url().split("/").pop()!;
  expect(await docStatus(page, "requests", prId)).toBe("PARTIAL");

  // เกินคงค้าง (เหลือ 4) ไม่ได้
  const prDetail = await (await page.request.get(`/api/purchase/requests/${prId}`)).json();
  const lineId = prDetail.lines[0].id;
  const over = await page.request.post("/api/purchase/orders", {
    data: { docDate: TODAY, vendorId: c.vendorId, lines: [{ productId: c.productId, requestLineId: lineId, quantity: 5, unitPrice: 1 }] },
  });
  expect(over.status()).toBe(409);
  expect((await over.json()).error).toMatch(/เกินจำนวนคงค้าง.*คงค้าง 4/);
  await ok(await page.request.post("/api/purchase/orders", { data: { docDate: TODAY, vendorId: c.vendorId, lines: [{ productId: c.productId, requestLineId: lineId, quantity: 4, unitPrice: 1 }] } }));
  expect(await docStatus(page, "requests", prId)).toBe("COMPLETED");
  await page.goto(`/purchase/requests/${prId}`);
  await expect(page.getByTestId("status-stepper").getByText("สั่งซื้อแล้ว", { exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("pr-ordered")).toHaveText("10");

  // ยกเลิก PR ไม่ได้เพราะมี PO อ้างอิง; ยกเลิก PO แรก → PR กลับเป็นบางส่วน
  expect((await act(page.request, "requests", prId, "cancel", "x")).status()).toBe(409);
  await ok(await act(page.request, "orders", po1, "cancel", "ทดสอบ"));
  expect(await docStatus(page, "requests", prId)).toBe("PARTIAL");
});

test("PO 10 → นำเข้า 4 = นำเข้าแล้วบางส่วน และยอดคงคลัง +4 (สร้าง > ใบนำเข้า จากหน้า PO)", async ({ page }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);
  const po = await approvedOrder(page, c, 10);
  expect(await onHand(page, c.productCode)).toBe(0);

  await page.goto(`/purchase/orders/${po.id}`);
  await page.getByRole("link", { name: /สร้าง > ใบนำเข้า/ }).click();
  await expect(page).toHaveURL(/\/inventory\/receipts\/new\?po=/);
  await expect(page.locator("#purchaseOrderId")).toContainText(po.docNo);
  await expect(page.getByTestId("po-remaining")).toContainText("คงค้างตามใบสั่งซื้อ 10");
  await page.locator('[id^="location-"]').first().click();
  await page.getByRole("option", { name: new RegExp(`${c.ID}-A`) }).click();
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page).toHaveURL(/\/inventory\/receipts\/(?!new)[a-z0-9]+$/);
  const docNo = (await page.getByRole("heading", { name: /ใบนำเข้า/ }).innerText()).match(/GR\d{10}/)![0];
  await page.getByRole("button", { name: "สร้าง Barcode/SN รายการที่ 1" }).click();
  await page.locator("#snCount").fill("1");
  await page.locator("#qtyPerSerial").fill("4");
  await page.getByRole("button", { name: "สร้าง", exact: true }).click();
  await expect(page.getByTestId("serial-chip")).toHaveCount(1);
  const input = page.getByLabel("สแกน barcode");
  await input.fill(`${docNo}-001`);
  await input.press("Enter");
  await expect(page.getByTestId("scan-progress")).toHaveText("สแกนแล้ว 1 / 1");
  await page.getByRole("button", { name: "นำเข้า", exact: true }).click();
  await expect(page.getByText("นำเข้าแล้ว").first()).toBeVisible();

  expect(await docStatus(page, "orders", po.id)).toBe("PARTIAL");
  expect(await onHand(page, c.productCode)).toBe(4);
  await page.goto(`/purchase/orders/${po.id}`);
  await expect(page.getByTestId("status-stepper").getByText("นำเข้าแล้วบางส่วน", { exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("po-received")).toHaveText("4");

  // รับเกินคงค้าง (เหลือ 6) ไม่ได้ ตอนกดนำเข้า
  const gr = await receiveFromOrder(page, c, po.id, 7, false);
  const post = await page.request.post(`/api/inventory/receipts/${gr.id}/post`);
  expect(post.status()).toBe(409);
  expect((await post.json()).error).toMatch(/เกินจำนวนคงค้างของใบสั่งซื้อ \(คงค้าง 6\)/);
  // รับอีก 6 = นำเข้าแล้ว
  await receiveFromOrder(page, c, po.id, 6);
  expect(await docStatus(page, "orders", po.id)).toBe("COMPLETED");
});

test("อนุมัติ 2 ลำดับ: ลำดับ 1 มี A,B แค่ A กดก็ไปลำดับ 2; คนนอกลำดับกดไม่ได้; ไม่อนุมัติกลับเป็นร่าง", async ({ page, browser }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);
  const perms = { "purchase.request": { view: true, create: true, edit: true } };
  const [A, B, C, X] = [await createUserWithPerms(page.request, { permissions: perms }), await createUserWithPerms(page.request, { permissions: perms }), await createUserWithPerms(page.request, { permissions: perms }), await createUserWithPerms(page.request, { permissions: { "purchase.request": { view: true, approve: true } } })];
  // createUserWithPerms ตั้งนามสกุล = uid ที่อยู่ในอีเมล e2e-<uid>@test.local
  const uidOf = (email: string) => email.slice("e2e-".length, email.indexOf("@"));

  // ตั้งผังผ่านหน้าจอ: ลำดับ 1 = A, B / ลำดับ 2 = C
  await page.goto("/settings/approval");
  const card = page.getByTestId("approval-PR");
  for (const [step, users] of [[0, [A, B]], [1, [C]]] as const) {
    await card.getByRole("button", { name: "เพิ่มลำดับ" }).click();
    for (const u of users) {
      await card.locator(`#approver-PR-${step}`).click();
      await page.getByLabel("ค้นหา", { exact: true }).fill(uidOf(u.email));
      await page.getByRole("option", { name: new RegExp(uidOf(u.email)) }).click();
    }
  }
  await card.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByText("บันทึกผังอนุมัติใบขอซื้อแล้ว")).toBeVisible();
  await expect(card.getByTestId("approval-step")).toHaveCount(2);

  const pr = await ok(
    await page.request.post("/api/purchase/requests", { data: { docDate: TODAY, requesterId: c.adminId, reference: `e2e ${c.id}`, lines: [{ productId: c.productId, quantity: 3 }] } }),
  );
  await ok(await act(page.request, "requests", pr.id, "submit"));
  // admin มีสิทธิ์อนุมัติแต่ไม่อยู่ในผัง / X มีสิทธิ์อนุมัติแต่ไม่อยู่ในผัง / C อยู่ลำดับ 2
  expect((await act(page.request, "requests", pr.id, "approve")).status()).toBe(403);

  const login = async (u: { email: string; password: string }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await loginOk(p, u.email, u.password);
    return { ctx, p };
  };
  const x = await login(X);
  expect((await act(x.p.request, "requests", pr.id, "approve")).status()).toBe(403);
  await x.ctx.close();
  const cUser = await login(C);
  expect((await act(cUser.p.request, "requests", pr.id, "approve")).status()).toBe(403);

  // A อนุมัติผ่านหน้าจอ → ไปลำดับ 2
  const a = await login(A);
  await a.p.goto(`/purchase/requests/${pr.id}`);
  await a.p.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  await a.p.locator("#actionComment").fill("ok จาก A");
  await a.p.getByRole("button", { name: "ยืนยันอนุมัติ" }).click();
  await expect(a.p.getByTestId("approval-steps").locator("li").nth(1)).toContainText("(รออนุมัติ)");
  await expect(a.p.getByRole("button", { name: "อนุมัติ", exact: true })).toHaveCount(0);
  await a.ctx.close();
  // B (ลำดับ 1 ผ่านไปแล้ว) กดไม่ได้
  const b = await login(B);
  expect((await act(b.p.request, "requests", pr.id, "approve")).status()).toBe(403);
  await b.ctx.close();

  // C ไม่อนุมัติ (ต้องมีเหตุผล) → กลับเป็นร่าง
  await cUser.p.goto(`/purchase/requests/${pr.id}`);
  await cUser.p.getByRole("button", { name: "ไม่อนุมัติ" }).click();
  await cUser.p.getByRole("button", { name: "ยืนยันไม่อนุมัติ" }).click();
  await expect(cUser.p.getByText("กรุณากรอกเหตุผลที่ไม่อนุมัติ")).toBeVisible();
  await cUser.p.locator("#actionComment").fill("จำนวนไม่ถูกต้อง");
  await cUser.p.getByRole("button", { name: "ยืนยันไม่อนุมัติ" }).click();
  await expect(cUser.p.getByTestId("status-stepper").getByText("ร่าง", { exact: true })).toHaveAttribute("aria-current", "step");
  const history = cUser.p.getByTestId("approval-history");
  await expect(history).toContainText("อนุมัติ ลำดับ 1");
  await expect(history).toContainText("ok จาก A");
  await expect(history).toContainText("ไม่อนุมัติ ลำดับ 2");
  await expect(history).toContainText("จำนวนไม่ถูกต้อง");
  await cUser.ctx.close();
  expect(await docStatus(page, "requests", pr.id)).toBe("DRAFT");
});

test("ใบส่งคืน: สร้างจาก PO → อนุมัติ → สร้าง > ใบนำออก (สแกน SN) → ส่งคืนแล้ว ยอดลด", async ({ page }) => {
  test.slow();
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);
  const po = await approvedOrder(page, c, 10);
  const gr = await receiveFromOrder(page, c, po.id, 5);
  expect(await onHand(page, c.productCode)).toBe(5);

  await page.goto(`/purchase/orders/${po.id}`);
  await page.getByRole("link", { name: /สร้าง > ใบส่งคืน/ }).click();
  await expect(page.locator("#orderId")).toContainText(po.docNo);
  await expect(page.locator("#vendorName")).toHaveValue(c.vendorName);
  await page.getByLabel(`จำนวนที่คืน ${c.productCode}`).fill("6");
  await page.locator("#reasonId").click();
  await page.getByRole("option", { name: "สินค้าชำรุด" }).click();
  await page.locator("#note").fill(`e2e ${c.id}`);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByText("เกินจำนวนที่คืนได้ (5)")).toBeVisible();
  await page.getByLabel(`จำนวนที่คืน ${c.productCode}`).fill("2");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page).toHaveURL(/\/purchase\/returns\/(?!new)[a-z0-9]+$/);
  const rtId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "ส่งอนุมัติ" }).click();
  await expect(page.getByRole("button", { name: "อนุมัติ", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "อนุมัติ", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันอนุมัติ" }).click();
  await expect(page.getByRole("link", { name: /สร้าง > ใบนำออก/ })).toBeVisible();
  // ยกเลิก PO ไม่ได้ (มีใบนำเข้า/ใบส่งคืน)
  expect((await act(page.request, "orders", po.id, "cancel", "x")).status()).toBe(409);

  await page.getByRole("link", { name: /สร้าง > ใบนำออก/ }).click();
  await expect(page).toHaveURL(/\/inventory\/issues\/new\?rt=/);
  await expect(page.getByTestId("return-expected")).toContainText("2");
  const input = page.getByLabel("สแกน barcode");
  await input.fill(`${gr.docNo}-001`);
  await input.press("Enter");
  await expect(page.getByTestId("issue-line")).toHaveCount(1);
  // จำนวนเริ่มต้น = ไม่เกินที่ต้องคืน (2) แม้ SN เหลือ 5
  await expect(page.getByLabel(`จำนวนนำออก ${gr.docNo}-001`)).toHaveValue("2");
  await page.getByRole("button", { name: "นำออก", exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/issues\/(?!new)[a-z0-9]+$/);
  await expect(page.getByText("นำออกแล้ว").first()).toBeVisible();

  expect(await docStatus(page, "returns", rtId)).toBe("COMPLETED");
  expect(await onHand(page, c.productCode)).toBe(3);
  await page.goto(`/purchase/returns/${rtId}`);
  await expect(page.getByTestId("status-stepper").getByText("ส่งคืนแล้ว", { exact: true })).toHaveAttribute("aria-current", "step");
});

test("พิมพ์ PO (A4 + ข้อมูลบริษัท) และหมายเหตุสำเร็จรูป", async ({ page }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);

  // หมายเหตุสำเร็จรูป: เพิ่มในตั้งค่า แล้วเลือกใส่ในใบขอซื้อ
  await page.goto("/settings/remarks");
  await page.getByRole("button", { name: "เพิ่มหมายเหตุ" }).click();
  await page.locator("#noteTitle").fill(`เงื่อนไข ${c.id}`);
  await page.locator("#noteBody").fill(`ส่งของภายใน 7 วัน ${c.id}`);
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.getByTestId("note-row").filter({ hasText: `เงื่อนไข ${c.id}` })).toBeVisible();
  await page.goto("/purchase/requests/new");
  await page.locator("#note").fill("บรรทัดแรก");
  await page.getByLabel("เลือกหมายเหตุสำเร็จรูป").click();
  await page.getByRole("option", { name: `เงื่อนไข ${c.id}` }).click();
  await expect(page.locator("#note")).toHaveValue(`บรรทัดแรก\nส่งของภายใน 7 วัน ${c.id}`);

  const company = await (await page.request.get("/api/settings/company")).json();
  const po = await approvedOrder(page, c, 10, 1250);
  await page.goto(`/print/purchase/orders/${po.id}`);
  const doc = page.getByTestId("print-document");
  await expect(doc).toContainText("ใบสั่งซื้อ/PurchaseOrder");
  await expect(doc).toContainText("(ต้นฉบับ/Original)");
  await expect(doc).toContainText(po.docNo);
  if (company.nameTh) await expect(doc).toContainText(company.nameTh);
  await expect(doc).toContainText(c.vendorName);
  await expect(doc).toContainText("12,500.00");
  await expect(doc).toContainText("875.00");
  await expect(doc).toContainText("13,375.00");
  await expect(doc).toContainText("ผู้อนุมัติ");
});

test("สิทธิ์: ดูอย่างเดียวสร้าง/ส่ง/อนุมัติไม่ได้; ไม่มีสิทธิ์อนุมัติและไม่ได้ตั้งผัง = อนุมัติไม่ได้", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);
  const po = await ok(await page.request.post("/api/purchase/orders", { data: { docDate: TODAY, vendorId: c.vendorId, note: `e2e ${c.id}`, lines: [{ productId: c.productId, quantity: 1, unitPrice: 1 }] } }));
  await ok(await act(page.request, "orders", po.id, "submit"));
  const viewer = await createUserWithPerms(page.request, { permissions: { "purchase.order": { view: true, edit: true } } });

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, viewer.email, viewer.password);
  await expect(p2.locator('aside [data-menu-key="purchase.order"]')).toBeVisible();
  await expect(p2.locator('aside [data-menu-key="purchase.request"]')).toHaveCount(0);
  expect((await p2.request.get("/api/purchase/requests")).status()).toBe(403);
  expect((await p2.request.post("/api/purchase/orders", { data: {} })).status()).toBe(403);
  // ไม่ได้ตั้งผัง PO + ไม่มีสิทธิ์ "อนุมัติ" → 403 และไม่มีปุ่ม
  expect((await act(p2.request, "orders", po.id, "approve")).status()).toBe(403);
  expect((await act(p2.request, "orders", po.id, "cancel", "x")).status()).toBe(403);
  await p2.goto(`/purchase/orders/${po.id}`);
  await expect(p2.getByRole("heading", { name: new RegExp(po.docNo) })).toBeVisible();
  await expect(p2.getByRole("button", { name: "อนุมัติ", exact: true })).toHaveCount(0);
  await p2.goto("/settings/approval");
  await expect(p2).toHaveURL(/\/forbidden/);
  await ctx.close();
});
