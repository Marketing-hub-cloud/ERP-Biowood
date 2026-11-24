import { expect, test, type Page } from "@playwright/test";
import { ADMIN, createUserWithPerms, loginOk, uid } from "./helpers";

type Ctx = { id: string; ID: string; whId: string; locId: string; productId: string; productCode: string };

/** เตรียมคลัง + สถานที่ + หน่วย + สินค้า ของเทสเอง (ผ่าน API ของ admin) */
async function setup(page: Page): Promise<Ctx> {
  const id = uid();
  const ID = id.toUpperCase();
  const post = async (url: string, data: object) => {
    const r = await page.request.post(url, { data });
    expect(r.status(), `${url} ${await r.text()}`).toBe(200);
    return (await r.json()).id as string;
  };
  const whId = await post("/api/inventory/tree/locations", { parentId: null, code: `${ID}-W`, name: `คลัง ${id}` });
  const locId = await post("/api/inventory/tree/locations", { parentId: whId, code: `${ID}-A`, name: `โซน ${id}` });
  const unitId = await post("/api/inventory/units", { name: `แผ่น${id}` });
  const productCode = `${ID}-DECK`;
  const productId = await post("/api/products", { code: productCode, name: `ไม้พื้น ${id}`, isStockable: true, stockUnitId: unitId, attributes: {} });
  return { id, ID, whId, locId, productId, productCode };
}

async function pickSelect(page: Page, triggerId: string, option: string | RegExp) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option }).click();
}

async function onHand(page: Page, productCode: string) {
  const r = await page.request.get(`/api/products?q=${encodeURIComponent(productCode)}`);
  return (await r.json()).rows[0].onHand as number;
}

async function scan(page: Page, code: string) {
  const input = page.getByLabel("สแกน barcode");
  await input.fill(code);
  await input.press("Enter");
}

test("นำเข้า: สร้างใบ → สร้าง SN 5×10 → พิมพ์ label → สแกนครบ → นำเข้า → ยอดคงคลัง 50", async ({ page }) => {
  test.slow(); // หลายขั้นตอน + DB ภายนอก
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);

  await page.goto("/inventory/receipts/new");
  await pickSelect(page, "warehouseId", new RegExp(`${c.ID}-W`));
  await page.locator("#lot").fill(`LOT-${c.id}`);
  await page.locator("#product-l1").click();
  await page.getByLabel("ค้นหา").fill(c.productCode);
  await page.getByRole("option", { name: new RegExp(c.productCode) }).click();
  await pickSelect(page, "location-l1", new RegExp(`${c.ID}-A`));
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page).toHaveURL(/\/inventory\/receipts\/(?!new)[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: /ใบนำเข้า GR\d{10}/ })).toBeVisible();
  const docNo = (await page.getByRole("heading", { name: /ใบนำเข้า/ }).innerText()).match(/GR\d{10}/)![0];
  const receiptId = page.url().split("/").pop()!;

  // ยังไม่มี SN → กดนำเข้าไม่ได้
  await expect(page.getByRole("button", { name: "นำเข้า", exact: true })).toBeDisabled();

  // สร้าง SN 5 × 10
  await page.getByRole("button", { name: "สร้าง Barcode/SN รายการที่ 1" }).click();
  await page.locator("#snCount").fill("5");
  await page.locator("#qtyPerSerial").fill("10");
  await expect(page.getByText("รวม: 50")).toBeVisible();
  await page.getByRole("button", { name: "สร้าง", exact: true }).click();
  await expect(page.getByTestId("serial-chip")).toHaveCount(5);
  await expect(page.getByTestId("line-qty")).toHaveText("50");
  await expect(page.getByTestId("serial-chip").first()).toContainText(`${docNo}-001`);

  // หน้า label: 5 ใบ มี barcode Code128 (SVG มีแท่ง)
  await page.goto(`/print/labels/${receiptId}`);
  await expect(page.getByTestId("label")).toHaveCount(5);
  await expect(page.locator(`svg[data-barcode="${docNo}-003"] rect`).first()).toBeAttached();
  await expect(page.getByTestId("label").first()).toContainText(c.productCode);
  await expect(page.getByTestId("label").first()).toContainText(`Lot LOT-${c.id}`);
  await page.locator("#labelPreset").click();
  await page.getByRole("option", { name: "40 × 25" }).click();
  await expect(page.getByTestId("label").first()).toHaveCSS("width", /^15[01]/); // 40mm ≈ 151px
  await page.goto(`/inventory/receipts/${receiptId}`);

  // สแกน: ไม่อยู่ในใบ / ครบ / ซ้ำ
  await scan(page, "NOT-A-REAL-BARCODE");
  await expect(page.getByText("ไม่พบ NOT-A-REAL-BARCODE ในใบนำเข้านี้").first()).toBeVisible();
  for (let i = 1; i <= 5; i++) await scan(page, `${docNo}-00${i}`);
  await expect(page.getByTestId("scan-progress")).toHaveText("สแกนแล้ว 5 / 5");
  await scan(page, `${docNo}-001`);
  await expect(page.getByText("สแกนซ้ำ (สแกนไปแล้ว)")).toBeVisible();
  await expect(page.locator('[data-testid="serial-chip"][data-scanned="yes"]')).toHaveCount(5);

  // ยอดยังไม่เข้า จนกว่าจะกดนำเข้า
  expect(await onHand(page, c.productCode)).toBe(0);
  await page.getByRole("button", { name: "นำเข้า", exact: true }).click();
  await expect(page.getByText("นำเข้าแล้ว").first()).toBeVisible();
  expect(await onHand(page, c.productCode)).toBe(50);

  // นำเข้าซ้ำไม่ได้ (API ตรง)
  expect((await page.request.post(`/api/inventory/receipts/${receiptId}/post`)).status()).toBe(409);

  // แท็บจำนวนสินค้าคงคลังของสินค้า
  await page.goto(`/inventory/products/${c.productId}`);
  await page.getByRole("tab", { name: "จำนวนสินค้าคงคลัง" }).click();
  await expect(page.getByTestId("stock-row")).toHaveCount(5);
  await expect(page.getByTestId("stock-total")).toContainText("50");
  await expect(page.getByTestId("stock-row").first()).toContainText(`โซน ${c.id}`);

  // มีความเคลื่อนไหวแล้ว: ลบสินค้า / เปลี่ยนหน่วย ไม่ได้ / ลบสถานที่ไม่ได้
  expect((await page.request.delete(`/api/products/${c.productId}`)).status()).toBe(400);
  const unit2 = await (await page.request.post("/api/inventory/units", { data: { name: `กล่อง${c.id}` } })).json();
  const chg = await page.request.patch(`/api/products/${c.productId}`, {
    data: { code: c.productCode, name: `ไม้พื้น ${c.id}`, isStockable: true, stockUnitId: unit2.id, attributes: {} },
  });
  expect(chg.status()).toBe(400);
  expect((await chg.json()).error).toMatch(/เปลี่ยนหน่วยสต๊อกไม่ได้/);
  const delLoc = await page.request.delete(`/api/inventory/tree/locations/${c.locId}`);
  expect(delLoc.status()).toBe(400);
  expect((await delLoc.json()).error).toMatch(/ความเคลื่อนไหวในคลัง/);

  // CSV รายการนำเข้า
  const csv = await page.request.get(`/api/inventory/receipts?format=csv&q=${docNo}`);
  const text = await csv.text();
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain(c.productCode);
  expect(text).toContain("นำเข้าแล้ว");
});

test("นำออก: สแกน SN → ระบุจำนวน → นำออก / เกินคงเหลือไม่ได้ แม้ส่งพร้อมกัน / ยกเลิกแล้วยอดคืน", async ({ page }) => {
  test.slow(); // หลายขั้นตอน + DB ภายนอก
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);

  // นำเข้า 3 SN × 10 ผ่าน API
  const gr = await (
    await page.request.post("/api/inventory/receipts", {
      data: { type: "OTHER", docDate: "2026-11-24", warehouseId: c.whId, lot: `L${c.id}`, lines: [{ productId: c.productId, locationId: c.locId }] },
    })
  ).json();
  const detail = await (await page.request.get(`/api/inventory/receipts/${gr.id}`)).json();
  const lineId = detail.lines[0].id;
  expect((await page.request.post(`/api/inventory/receipts/${gr.id}/lines/${lineId}/serials`, { data: { count: 3, qtyPerSerial: 10 } })).status()).toBe(200);
  const sn = (n: number) => `${gr.docNo}-00${n}`;
  for (const n of [1, 2, 3]) expect((await page.request.post(`/api/inventory/receipts/${gr.id}/scan`, { data: { barcode: sn(n) } })).status()).toBe(200);
  expect((await page.request.post(`/api/inventory/receipts/${gr.id}/post`)).status()).toBe(200);
  expect(await onHand(page, c.productCode)).toBe(30);

  // ลูกค้า (มีที่อยู่จัดส่ง)
  const contact = await page.request.post("/api/contacts", {
    data: {
      isCustomer: true,
      isVendor: false,
      entityType: "JURISTIC",
      name: `ลูกค้า ${c.id}`,
      reg: {},
      shippingAddresses: [{ label: "หน้างาน", recipient: "คุณสมชาย", address: "99/1 ถนนสุขุมวิท", province: "กรุงเทพมหานคร", postalCode: "10110", isDefault: true }],
      channels: [],
      persons: [],
      tagIds: [],
    },
  });
  expect(contact.status(), await contact.text()).toBe(200);

  // ใบนำออกผ่าน UI: ประเภทขาย ต้องเลือกลูกค้า
  await page.goto("/inventory/issues/new");
  await scan(page, sn(1));
  await expect(page.getByTestId("issue-line")).toHaveCount(1);
  await scan(page, sn(1));
  await expect(page.getByText(`${sn(1)} อยู่ในรายการแล้ว`)).toBeVisible();
  await scan(page, sn(2));
  await expect(page.getByTestId("issue-line")).toHaveCount(2);
  await page.getByLabel(`จำนวนนำออก ${sn(2)}`).fill("5");
  await page.getByRole("button", { name: "นำออก", exact: true }).click();
  await expect(page.getByText("ประเภทขายต้องเลือกลูกค้า").first()).toBeVisible();

  await page.locator("#contactId").click();
  await page.getByLabel("ค้นหาผู้ติดต่อ").fill(c.id);
  await page.getByRole("option", { name: new RegExp(`ลูกค้า ${c.id}`) }).click();
  await expect(page.locator("#shippingAddress")).toHaveValue(/99\/1 ถนนสุขุมวิท/);
  await expect(page.locator("#recipientName")).toHaveValue("คุณสมชาย");
  // เกินคงเหลือ (ฝั่ง client)
  await page.getByLabel(`จำนวนนำออก ${sn(2)}`).fill("11");
  await page.getByRole("button", { name: "นำออก", exact: true }).click();
  await expect(page.getByText("เกินคงเหลือ (10)")).toBeVisible();
  await page.getByLabel(`จำนวนนำออก ${sn(2)}`).fill("5");
  await expect(page.getByTestId("issue-total")).toHaveText("15");
  await page.getByRole("button", { name: "นำออก", exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/issues\/(?!new)[a-z0-9]+$/);
  await expect(page.getByText("นำออกแล้ว").first()).toBeVisible();
  const issueId = page.url().split("/").pop()!;
  expect(await onHand(page, c.productCode)).toBe(15);

  // SN ที่หมดแล้วสแกนนำออกไม่ได้
  await page.goto("/inventory/issues/new");
  await scan(page, sn(1));
  await expect(page.getByText(`${sn(1)} ไม่มีคงเหลือ`)).toBeVisible();
  await expect(page.getByTestId("issue-line")).toHaveCount(0);

  // API ตรง: เกินคงเหลือ (SN 2 เหลือ 5)
  const serial2 = (await (await page.request.get(`/api/inventory/serials/lookup?barcode=${sn(2)}`)).json()) as { serialId: string; balance: number };
  expect(serial2.balance).toBe(5);
  const over = await page.request.post("/api/inventory/issues", {
    data: { type: "OTHER", docDate: "2026-11-24", note: `over ${c.id}`, lines: [{ serialId: serial2.serialId, quantity: 6 }], post: true },
  });
  expect(over.status()).toBe(400);
  expect((await over.json()).error).toMatch(/เกินคงเหลือ/);

  // ส่งพร้อมกัน 2 ครั้ง (6 + 6 จาก SN 3 ที่เหลือ 10) → สำเร็จครั้งเดียว
  const serial3 = (await (await page.request.get(`/api/inventory/serials/lookup?barcode=${sn(3)}`)).json()) as { serialId: string };
  const both = await Promise.all(
    [1, 2].map((n) =>
      page.request.post("/api/inventory/issues", {
        data: { type: "OTHER", docDate: "2026-11-24", note: `race${n} ${c.id}`, lines: [{ serialId: serial3.serialId, quantity: 6 }], post: true },
      }),
    ),
  );
  expect(both.map((r) => r.status()).sort()).toEqual([200, 409]);
  expect(await onHand(page, c.productCode)).toBe(9);

  // ยกเลิกใบนำเข้าไม่ได้ เพราะมีการนำออกแล้ว
  const cancelGr = await page.request.post(`/api/inventory/receipts/${gr.id}/cancel`, { data: { reason: "ทดสอบ" } });
  expect(cancelGr.status()).toBe(409);

  // ยกเลิกใบนำออก (UI) → ยอดคืน 15
  await page.goto(`/inventory/issues/${issueId}`);
  await page.getByRole("button", { name: "ยกเลิกเอกสาร" }).click();
  await page.getByRole("button", { name: "ยืนยันยกเลิกเอกสาร" }).click();
  await expect(page.getByText("กรุณากรอกเหตุผลการยกเลิก")).toBeVisible();
  await page.locator("#cancelReason").fill("ลูกค้ายกเลิก");
  await page.getByRole("button", { name: "ยืนยันยกเลิกเอกสาร" }).click();
  await expect(page.getByText("ใบนำออกนี้ถูกยกเลิกแล้ว")).toBeVisible();
  expect(await onHand(page, c.productCode)).toBe(24);

  // ประวัติ (audit) ของใบนำออก
  await page.getByRole("button", { name: /ประวัติ/ }).click();
  await expect(page.getByText("ยกเลิกและคืนสต๊อก: ลูกค้ายกเลิก")).toBeVisible();
});

test("สิทธิ์: ดูอย่างเดียวสร้าง/สแกน/นำเข้าไม่ได้ (403) และไม่มีสิทธิ์ view เมนูหาย", async ({ page, browser }) => {
  await loginOk(page, ADMIN.email, ADMIN.password);
  const c = await setup(page);
  const gr = await (
    await page.request.post("/api/inventory/receipts", { data: { docDate: "2026-11-24", warehouseId: c.whId, lines: [{ productId: c.productId, locationId: c.locId }] } })
  ).json();
  const u = await createUserWithPerms(page.request, { permissions: { "inventory.receipt": { view: true } } });

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await loginOk(p2, u.email, u.password);
  const aside = p2.locator("aside");
  await expect(aside.locator('[data-menu-key="inventory.receipt"]')).toBeVisible();
  await expect(aside.locator('[data-menu-key="inventory.issue"]')).toHaveCount(0);

  expect((await p2.request.get("/api/inventory/receipts")).status()).toBe(200);
  expect((await p2.request.post("/api/inventory/receipts", { data: {} })).status()).toBe(403);
  expect((await p2.request.post(`/api/inventory/receipts/${gr.id}/scan`, { data: { barcode: "x" } })).status()).toBe(403);
  expect((await p2.request.post(`/api/inventory/receipts/${gr.id}/post`)).status()).toBe(403);
  expect((await p2.request.post(`/api/inventory/receipts/${gr.id}/cancel`, { data: { reason: "x" } })).status()).toBe(403);
  expect((await p2.request.get("/api/inventory/issues")).status()).toBe(403);
  expect((await p2.request.get("/api/inventory/serials/lookup?barcode=x")).status()).toBe(403);

  await p2.goto("/inventory/receipts/new");
  await expect(p2).toHaveURL(/\/forbidden/);
  await p2.goto("/inventory/issues");
  await expect(p2).toHaveURL(/\/forbidden/);
  await p2.goto(`/inventory/receipts/${gr.id}`);
  await expect(p2.getByRole("heading", { name: new RegExp(gr.docNo) })).toBeVisible();
  await expect(p2.getByRole("button", { name: "บันทึก" })).toHaveCount(0);
  await expect(p2.locator("#lot")).toBeDisabled();
  await ctx.close();
});
