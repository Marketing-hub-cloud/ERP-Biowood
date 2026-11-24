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

      const all = [...users, ...groups, ...contacts, ...products, ...attributes, ...units, ...categories, ...locations];
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
