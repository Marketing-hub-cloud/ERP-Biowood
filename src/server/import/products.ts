import "server-only";
import { prisma } from "@/lib/db";
import { parseBool } from "@/lib/csv-parse";
import { validateAttributeValues, type AttributeDef } from "@/lib/product-rules";
import { productSchema, type ProductInput } from "@/lib/validators";
import { createProduct } from "@/server/products";
import { csvRow, errorText, headerFor, LookupResolver, type ImportPlan, type Importer, type RowError } from "./common";

type ProductRow = { input: ProductInput; productType: string; categoryPath: string[]; unit: string; attributes: Record<string, string> };

const splitPath = (s: string) =>
  s
    .split(">")
    .map((x) => x.trim())
    .filter(Boolean);

async function activeAttributes(): Promise<AttributeDef[]> {
  return (await prisma.productAttribute.findMany({ where: { isActive: true } })) as AttributeDef[];
}

/** หมวดหมู่ตาม path ชื่อ (สร้างระดับที่ยังไม่มี) */
async function ensureCategory(path: string[]): Promise<string | null> {
  let parentId: string | null = null;
  for (const [i, name] of path.entries()) {
    const found: { id: string } | null = await prisma.productCategory.findFirst({ where: { parentId, name } });
    parentId = found ? found.id : (await prisma.productCategory.create({ data: { parentId, level: i + 1, name, sortOrder: 999 } })).id;
  }
  return parentId;
}

export const productsImporter: Importer<ProductRow> & { lookups?: LookupResolver } = {
  kind: "products",
  title: "สินค้า",
  description: "1 แถว = สินค้า 1 รายการ รหัสซ้ำกับที่มีอยู่จะข้าม — เพิ่มคอลัมน์ชื่อตรงกับ \"คุณสมบัติ\" ในตั้งค่าคลังเพื่อกรอกข้อมูลเฉพาะได้",
  columns: [
    { header: "รหัสสินค้า", required: true, example: "BW-DK145-DB", help: "A-Z 0-9 - _ . / (ตัวเล็กแปลงเป็นตัวใหญ่)" },
    { header: "ชื่อสินค้า", required: true, example: "ไม้พื้นคอมโพสิต 145 มม. สีน้ำตาลเข้ม", help: "" },
    { header: "ประเภทสินค้า", example: "วัสดุไม้", help: "ไม่มีในระบบ = สร้างตัวเลือกใหม่" },
    { header: "หมวดหมู่", example: "ไม้พื้น > คอมโพสิต > ลายไม้", help: "ระดับ 1 > 2 > 3 (ไม่เกิน 3 ระดับ) ไม่มี = สร้างใหม่" },
    { header: "รายละเอียด", example: "", help: "" },
    { header: "สต๊อกได้", example: "ใช่", help: "ใช่/ไม่ (ว่าง = ใช่)" },
    { header: "หน่วย", example: "แผ่น", help: "หน่วยสต๊อก (บังคับถ้าสต๊อกได้) ไม่มี = สร้างใหม่" },
    { header: "ใช้งาน", example: "ใช่", help: "ใช่/ไม่ (ว่าง = ใช่)" },
  ],

  async extraColumn(header) {
    const attrs = await activeAttributes();
    return attrs.some((a) => a.name === header) ? null : `ไม่รู้จักคอลัมน์ "${header}" (ไม่ใช่คอลัมน์ในแม่แบบ และไม่ตรงกับชื่อคุณสมบัติใน ตั้งค่าคลัง > คุณสมบัติ)`;
  },

  async plan(records) {
    const lookups = new LookupResolver();
    this.lookups = lookups;
    const errors: RowError[] = [];
    const rows: ImportPlan<ProductRow>["rows"] = [];
    const attrs = await activeAttributes();
    const existing = new Set((await prisma.product.findMany({ select: { code: true } })).map((p) => p.code));
    const units = new Set((await prisma.unit.findMany()).map((u) => u.name));
    const newUnits = new Set<string>();
    const newCats = new Set<string>();
    const cats = await prisma.productCategory.findMany();
    const catExists = (path: string[]) => {
      let parentId: string | null = null;
      for (const name of path) {
        const c = cats.find((x) => x.parentId === parentId && x.name === name);
        if (!c) return false;
        parentId = c.id;
      }
      return true;
    };
    const fileCodes = new Map<string, number>();

    for (const [i, r] of records.entries()) {
      const row = csvRow(i);
      const err = (column: string, message: string) => errors.push({ row, column, message });
      const isStockable = parseBool(r["สต๊อกได้"] ?? "", true);
      const isActive = parseBool(r["ใช้งาน"] ?? "", true);
      if (isStockable === undefined) err("สต๊อกได้", "ต้องเป็น ใช่/ไม่");
      if (isActive === undefined) err("ใช้งาน", "ต้องเป็น ใช่/ไม่");
      const unit = r["หน่วย"] ?? "";
      const path = splitPath(r["หมวดหมู่"] ?? "");
      if (path.length > 3) err("หมวดหมู่", "หมวดหมู่ซ้อนได้ไม่เกิน 3 ระดับ");
      const attributes: Record<string, string> = {};
      for (const a of attrs) if (r[a.name]) attributes[a.id] = r[a.name];
      for (const [id, msg] of Object.entries(validateAttributeValues(attrs, attributes))) err(attrs.find((a) => a.id === id)?.name ?? id, msg);

      const input: ProductInput = {
        code: r["รหัสสินค้า"] ?? "",
        name: r["ชื่อสินค้า"] ?? "",
        description: r["รายละเอียด"] || null,
        isStockable: isStockable ?? true,
        isActive: isActive ?? true,
        // ตรวจ schema ด้วยค่าชั่วคราว (id จริงหาได้ตอน commit)
        stockUnitId: unit ? "pending" : null,
        attributes: {},
      };
      const parsed = productSchema.safeParse(input);
      if (!parsed.success) {
        for (const iss of parsed.error.issues) err(headerFor(iss.path, { code: "รหัสสินค้า", name: "ชื่อสินค้า", description: "รายละเอียด", stockUnitId: "หน่วย" }), iss.message);
        continue;
      }
      if (errors.some((e) => e.row === row)) continue;
      const code = parsed.data.code;
      if (fileCodes.has(code)) {
        err("รหัสสินค้า", `รหัส ${code} ซ้ำกับแถว ${fileCodes.get(code)}`);
        continue;
      }
      fileCodes.set(code, row);
      if (unit && !units.has(unit)) newUnits.add(unit);
      if (path.length && !catExists(path)) newCats.add(path.join(" > "));
      await lookups.note("PRODUCT_TYPE", r["ประเภทสินค้า"] ?? "");
      const data = { input, productType: r["ประเภทสินค้า"] ?? "", categoryPath: path, unit, attributes };
      rows.push(existing.has(code) ? { row, data, action: "skip", note: `มีรหัส ${code} อยู่แล้ว` } : { row, data, action: "create" });
    }
    const notes = lookups.describe({ PRODUCT_TYPE: "ประเภทสินค้า" });
    if (newUnits.size) notes.push(`จะสร้างหน่วยใหม่: ${[...newUnits].join(", ")}`);
    if (newCats.size) notes.push(`จะสร้างหมวดหมู่ใหม่ ${newCats.size} เส้นทาง: ${[...newCats].slice(0, 10).join(" | ")}`);
    return { rows, errors, notes };
  },

  async commit(plan, ctx) {
    const lookups = this.lookups ?? new LookupResolver();
    let created = 0;
    for (const r of plan.rows.filter((x) => x.action === "create")) {
      const unitId = r.data.unit ? (await prisma.unit.upsert({ where: { name: r.data.unit }, update: { isActive: true }, create: { name: r.data.unit, sortOrder: 999 } })).id : null;
      const data = productSchema.parse({
        ...r.data.input,
        stockUnitId: unitId,
        productTypeId: await lookups.id(prisma, "PRODUCT_TYPE", r.data.productType),
        categoryId: await ensureCategory(r.data.categoryPath),
        attributes: r.data.attributes,
      });
      try {
        await createProduct(ctx.actor, data, null);
        created++;
      } catch (e) {
        throw new Error(`แถว ${r.row}: ${errorText(e)} (นำเข้าไปแล้ว ${created} รายการ)`);
      }
    }
    return { created, skipped: plan.rows.length - created, notes: [] };
  },
};
