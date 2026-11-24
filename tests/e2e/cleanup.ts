// ลบข้อมูลที่ e2e สร้างไว้ (ระบุจาก marker "e2e" ในชื่อ/รหัส และอีเมล @test.local)
// ใช้ทั้งก่อนเริ่ม (ล้างของค้างจากรอบที่ล้ม) และหลังจบเทส
import { readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const MARK = "%e2e%";
const SNAPSHOT = path.join(process.cwd(), "tests", "e2e", ".auth", "company-snapshot.json");

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const ids = async (c: Client, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows.map((r) => r.id as string);

/** id ของ node และลูกหลานทั้งหมดใน tree */
async function treeIds(c: Client, table: string, rootIds: string[]) {
  if (!rootIds.length) return [];
  const { rows } = await c.query(
    `WITH RECURSIVE t AS (SELECT id, level FROM ${table} WHERE id = ANY($1)
       UNION SELECT n.id, n.level FROM ${table} n JOIN t ON n."parentId" = t.id)
     SELECT id FROM t ORDER BY level DESC`,
    [rootIds],
  );
  return rows.map((r) => r.id as string);
}

export async function cleanupTestData(): Promise<Record<string, number>> {
  const uploadDir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
  const files: string[] = [];
  const counts = await withClient(async (c) => {
    const n: Record<string, number> = {};
    await c.query("BEGIN");
    try {
      const users = await ids(c, `SELECT id FROM users WHERE email LIKE '%@test.local'`);
      const groups = await ids(c, `SELECT id FROM permission_groups WHERE name LIKE 'E2E-%'`);
      const contacts = await ids(c, `SELECT id FROM contacts WHERE name ILIKE $1 OR code ILIKE $1 OR "createdById" = ANY($2)`, [MARK, users]);
      const products = await ids(c, `SELECT id FROM products WHERE code ILIKE $1 OR name ILIKE $1 OR "createdById" = ANY($2)`, [MARK, users]);
      const attributes = await ids(c, `SELECT id FROM product_attributes WHERE name ILIKE $1`, [MARK]);
      const units = await ids(c, `SELECT id FROM units WHERE name ILIKE $1`, [MARK]);
      const categories = await treeIds(c, "product_categories", await ids(c, `SELECT id FROM product_categories WHERE name ILIKE $1 OR code ILIKE $1`, [MARK]));
      const locations = await treeIds(c, "stock_locations", await ids(c, `SELECT id FROM stock_locations WHERE name ILIKE $1 OR code ILIKE $1`, [MARK]));
      const lookups = await ids(c, `SELECT id FROM lookup_options WHERE label ILIKE $1`, [MARK]);
      const tags = await ids(c, `SELECT id FROM tags WHERE name ILIKE $1`, [MARK]);

      // ไฟล์ที่ต้องลบหลัง commit
      files.push(...(await c.query(`SELECT key FROM product_images WHERE "productId" = ANY($1)`, [products])).rows.map((r) => r.key));
      files.push(...(await c.query(`SELECT "photoKey" AS key FROM contacts WHERE id = ANY($1) AND "photoKey" IS NOT NULL`, [contacts])).rows.map((r) => r.key));

      // เอกสารคลัง (เฟส 4) ที่อ้างอิงสินค้า/คลัง/ผู้ใช้ทดสอบ
      const receipts = await ids(
        c,
        `SELECT id FROM goods_receipts r WHERE "createdById" = ANY($1) OR "warehouseId" = ANY($2) OR lot ILIKE $4 OR note ILIKE $4
           OR EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l."receiptId" = r.id AND l."productId" = ANY($3))`,
        [users, locations, products, MARK],
      );
      const issues = await ids(
        c,
        `SELECT id FROM goods_issues i WHERE "createdById" = ANY($1) OR "contactId" = ANY($4) OR note ILIKE $5 OR "recipientName" ILIKE $5
           OR EXISTS (SELECT 1 FROM goods_issue_lines l JOIN stock_serials s ON s.id = l."serialId"
                      JOIN goods_receipt_lines rl ON rl.id = s."receiptLineId"
                      WHERE l."issueId" = i.id AND (l."productId" = ANY($3) OR rl."receiptId" = ANY($2)))`,
        [users, receipts, products, contacts, MARK],
      );
      n.movements =
        (await c.query(`DELETE FROM stock_movements WHERE "refId" = ANY($1) OR "refId" = ANY($2) OR "productId" = ANY($3)`, [receipts, issues, products])).rowCount ?? 0;
      n.issues = (await c.query(`DELETE FROM goods_issues WHERE id = ANY($1)`, [issues])).rowCount ?? 0;
      await c.query(`DELETE FROM stock_serials WHERE "receiptLineId" IN (SELECT id FROM goods_receipt_lines WHERE "receiptId" = ANY($1))`, [receipts]);
      n.receipts = (await c.query(`DELETE FROM goods_receipts WHERE id = ANY($1)`, [receipts])).rowCount ?? 0;

      // เอกสารจัดซื้อ (เฟส 5): อ้างอิงสินค้า/ผู้ขาย/ผู้ใช้ทดสอบ (ใบนำเข้า/นำออกที่อ้างอิงถูกลบไปแล้วข้างบน)
      const returns = await ids(
        c,
        `SELECT id FROM purchase_returns r WHERE "createdById" = ANY($1) OR "vendorId" = ANY($2) OR note ILIKE $4
           OR EXISTS (SELECT 1 FROM purchase_return_lines l WHERE l."returnId" = r.id AND l."productId" = ANY($3))`,
        [users, contacts, products, MARK],
      );
      const orders = await ids(
        c,
        `SELECT id FROM purchase_orders o WHERE "createdById" = ANY($1) OR "vendorId" = ANY($2) OR note ILIKE $4 OR reference ILIKE $4
           OR EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l."orderId" = o.id AND l."productId" = ANY($3))`,
        [users, contacts, products, MARK],
      );
      const requests = await ids(
        c,
        `SELECT id FROM purchase_requests r WHERE "createdById" = ANY($1) OR "requesterId" = ANY($1) OR note ILIKE $3 OR reference ILIKE $3
           OR EXISTS (SELECT 1 FROM purchase_request_lines l WHERE l."requestId" = r.id AND l."productId" = ANY($2))`,
        [users, products, MARK],
      );
      // ใบนำเข้า/นำออกที่อ้าง PO/RT เหล่านี้ (กรณีสินค้าไม่ใช่ของเทส)
      const moreIssues = await ids(c, `SELECT id FROM goods_issues WHERE "purchaseReturnId" = ANY($1)`, [returns]);
      const moreReceipts = await ids(c, `SELECT id FROM goods_receipts WHERE "purchaseOrderId" = ANY($1)`, [orders]);
      if (moreIssues.length || moreReceipts.length) {
        await c.query(`DELETE FROM stock_movements WHERE "refId" = ANY($1) OR "refId" = ANY($2)`, [moreIssues, moreReceipts]);
        await c.query(`DELETE FROM goods_issues WHERE id = ANY($1)`, [moreIssues]);
        await c.query(`DELETE FROM stock_serials WHERE "receiptLineId" IN (SELECT id FROM goods_receipt_lines WHERE "receiptId" = ANY($1))`, [moreReceipts]);
        await c.query(`DELETE FROM goods_receipts WHERE id = ANY($1)`, [moreReceipts]);
      }
      n.returns = (await c.query(`DELETE FROM purchase_returns WHERE id = ANY($1)`, [returns])).rowCount ?? 0;
      n.orders = (await c.query(`DELETE FROM purchase_orders WHERE id = ANY($1)`, [orders])).rowCount ?? 0;
      n.requests = (await c.query(`DELETE FROM purchase_requests WHERE id = ANY($1)`, [requests])).rowCount ?? 0;
      const purchaseDocs = [...returns, ...orders, ...requests];
      await c.query(`DELETE FROM approval_actions WHERE "docId" = ANY($1) OR "actorId" = ANY($2)`, [purchaseDocs, users]);
      await c.query(`DELETE FROM approval_step_approvers WHERE "userId" = ANY($1)`, [users]);
      await c.query(`DELETE FROM approval_steps s WHERE NOT EXISTS (SELECT 1 FROM approval_step_approvers a WHERE a."stepId" = s.id)`);
      n.noteTemplates = (await c.query(`DELETE FROM note_templates WHERE title ILIKE $1 OR body ILIKE $1`, [MARK])).rowCount ?? 0;
      // แจ้งเตือน (เฟส 6): ของเอกสารทดสอบ / ข้อความที่มี marker / กลุ่ม LINE ทดสอบ
      await c.query(`DELETE FROM notifications WHERE "docId" = ANY($1) OR "userId" = ANY($2)`, [purchaseDocs, users]);
      n.deliveries =
        (await c.query(`DELETE FROM notification_deliveries WHERE "refId" = ANY($1) OR message ILIKE $2 OR target ILIKE $2`, [purchaseDocs, MARK])).rowCount ?? 0;
      await c.query(`DELETE FROM line_groups WHERE "groupId" ILIKE $1 OR name ILIKE $1`, [MARK]);
      // แจ้งเตือนกำพร้า: เอกสารถูกลบไปแล้ว (ในระบบจริงเอกสารจัดซื้อลบไม่ได้ มีแต่จากเทส)
      n.orphanNotifications =
        (
          await c.query(`DELETE FROM notifications n WHERE
            (n."docType" = PR AND NOT EXISTS (SELECT 1 FROM purchase_requests WHERE id = n."docId") AND n."docId" <> ALL($1)) OR
            (n."docType" = PO AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE id = n."docId") AND n."docId" <> ALL($1)) OR
            (n."docType" = RT AND NOT EXISTS (SELECT 1 FROM purchase_returns WHERE id = n."docId") AND n."docId" <> ALL($1))`, [purchaseDocs])
        ).rowCount ?? 0;

      const all = [...users, ...groups, ...contacts, ...products, ...attributes, ...units, ...categories, ...locations, ...receipts, ...issues, ...purchaseDocs];
      n.auditLogs = (await c.query(`DELETE FROM audit_logs WHERE "entityId" = ANY($1) OR "actorId" = ANY($2)`, [all, users])).rowCount ?? 0;
      n.products = (await c.query(`DELETE FROM products WHERE id = ANY($1)`, [products])).rowCount ?? 0;
      await c.query(`DELETE FROM product_attribute_values WHERE "attributeId" = ANY($1)`, [attributes]);
      n.attributes = (await c.query(`DELETE FROM product_attributes WHERE id = ANY($1)`, [attributes])).rowCount ?? 0;
      n.units = (await c.query(`DELETE FROM units WHERE id = ANY($1)`, [units])).rowCount ?? 0;
      for (const id of categories) await c.query(`DELETE FROM product_categories WHERE id = $1`, [id]);
      for (const id of locations) await c.query(`DELETE FROM stock_locations WHERE id = $1`, [id]);
      n.categories = categories.length;
      n.locations = locations.length;
      n.contacts = (await c.query(`DELETE FROM contacts WHERE id = ANY($1)`, [contacts])).rowCount ?? 0;
      n.lookups = (await c.query(`DELETE FROM lookup_options WHERE id = ANY($1)`, [lookups])).rowCount ?? 0;
      n.tags = (await c.query(`DELETE FROM tags WHERE id = ANY($1)`, [tags])).rowCount ?? 0;
      n.groups = (await c.query(`DELETE FROM permission_groups WHERE id = ANY($1)`, [groups])).rowCount ?? 0;
      n.users = (await c.query(`DELETE FROM users WHERE id = ANY($1)`, [users])).rowCount ?? 0;
      // รหัสผู้ติดต่ออัตโนมัติ: ต่อจากรหัส CT ที่มากที่สุดที่เหลืออยู่
      await c.query(
        `UPDATE document_counters SET "lastSeq" = COALESCE((SELECT MAX(substring(code from 3)::int) FROM contacts WHERE code ~ '^CT[0-9]+$'), 0)
         WHERE prefix = 'CT' AND "dateKey" = ''`,
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    return n;
  });
  for (const key of files) await unlink(path.resolve(uploadDir, key)).catch(() => undefined);
  return counts;
}

/** เก็บข้อมูลบริษัทไว้ก่อนเทส (เทสข้อมูลบริษัทจะแก้ค่า) */
export async function snapshotCompany() {
  const row = await withClient(async (c) => (await c.query(`SELECT * FROM company_settings WHERE id = 1`)).rows[0] ?? null);
  await mkdir(path.dirname(SNAPSHOT), { recursive: true });
  await writeFile(SNAPSHOT, JSON.stringify(row));
}

/** คืนค่าข้อมูลบริษัท + ลบ audit log ที่เทสสร้างกับข้อมูลบริษัท */
export async function restoreCompany(since: Date) {
  const row = JSON.parse(await readFile(SNAPSHOT, "utf8").catch(() => "null"));
  if (!row) return;
  await withClient(async (c) => {
    await c.query(
      `UPDATE company_settings SET "nameTh"=$1, "nameEn"=$2, address=$3, "taxId"=$4, branch=$5, phone=$6, email=$7, website=$8, "logoKey"=$9 WHERE id = 1`,
      [row.nameTh, row.nameEn, row.address, row.taxId, row.branch, row.phone, row.email, row.website, row.logoKey],
    );
    await c.query(`DELETE FROM audit_logs WHERE "entityType" = 'CompanySetting' AND "createdAt" >= $1`, [since]);
  });
}

const APPROVAL_SNAPSHOT = path.join(process.cwd(), "tests", "e2e", ".auth", "approval-snapshot.json");

/** เก็บผังอนุมัติไว้ก่อนเทส (เทสการอนุมัติจะแก้ผัง) */
export async function snapshotApproval() {
  const rows = await withClient(async (c) =>
    (await c.query(`SELECT s."docType", s."stepNo", a."userId" FROM approval_steps s JOIN approval_step_approvers a ON a."stepId" = s.id ORDER BY 1, 2`)).rows,
  );
  await mkdir(path.dirname(APPROVAL_SNAPSHOT), { recursive: true });
  await writeFile(APPROVAL_SNAPSHOT, JSON.stringify(rows));
}

/** คืนค่าผังอนุมัติ + ลบ audit log ที่เทสสร้างกับการตั้งค่าอนุมัติ */
export async function restoreApproval(since: Date) {
  const rows: { docType: string; stepNo: number; userId: string }[] = JSON.parse(await readFile(APPROVAL_SNAPSHOT, "utf8").catch(() => "null")) ?? null;
  if (!rows) return;
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`DELETE FROM approval_steps`);
      const steps = new Map<string, string>();
      for (const r of rows) {
        const k = `${r.docType}:${r.stepNo}`;
        if (!steps.has(k)) {
          const id = `rs${Math.random().toString(36).slice(2, 12)}${steps.size}`;
          await c.query(`INSERT INTO approval_steps (id, "docType", "stepNo") VALUES ($1, $2, $3)`, [id, r.docType, r.stepNo]);
          steps.set(k, id);
        }
        await c.query(`INSERT INTO approval_step_approvers ("stepId", "userId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [steps.get(k), r.userId]);
      }
      await c.query(`DELETE FROM audit_logs WHERE "entityType" = 'ApprovalSetting' AND "createdAt" >= $1`, [since]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}

const NOTIFY_SNAPSHOT = path.join(process.cwd(), "tests", "e2e", ".auth", "notify-snapshot.json");

/** เก็บตั้งค่าแจ้งเตือนไว้ก่อนเทส */
export async function snapshotNotificationSettings() {
  const rows = await withClient(async (c) => (await c.query(`SELECT * FROM notification_settings`)).rows);
  await mkdir(path.dirname(NOTIFY_SNAPSHOT), { recursive: true });
  await writeFile(NOTIFY_SNAPSHOT, JSON.stringify(rows));
}

/** คืนค่าตั้งค่าแจ้งเตือน + ลบ audit log ที่เทสสร้าง */
export async function restoreNotificationSettings(since: Date) {
  const rows: { module: string; lineEnabled: boolean; lineGroupId: string | null; lineGroupName: string | null; updatedById: string | null }[] | null = JSON.parse(
    await readFile(NOTIFY_SNAPSHOT, "utf8").catch(() => "null"),
  );
  if (!rows) return;
  await withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(`DELETE FROM notification_settings`);
      for (const r of rows) {
        await c.query(
          `INSERT INTO notification_settings (module, "lineEnabled", "lineGroupId", "lineGroupName", "updatedById", "updatedAt") VALUES ($1, $2, $3, $4, $5, now())`,
          [r.module, r.lineEnabled, r.lineGroupId, r.lineGroupName, r.updatedById],
        );
      }
      await c.query(`DELETE FROM audit_logs WHERE "entityType" = 'NotificationSetting' AND "createdAt" >= $1`, [since]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}
