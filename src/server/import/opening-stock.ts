import "server-only";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { allocateDocNumber, DOC_PREFIXES } from "@/lib/doc-number";
import { bangkokLocalToDate } from "@/lib/date-input";
import { postReceipt, STOCK_TX } from "@/lib/stock-ledger";
import { dateOnly, fromMilli, MAX_SERIALS_PER_BATCH, MAX_SERIALS_PER_RECEIPT, parseQty, serialBarcode, toMilli } from "@/lib/stock-rules";
import { ENTITY_RECEIPT, receiptSnapshot } from "@/server/goods-receipts";
import { csvRow, type ImportPlan, type Importer, type RowError } from "./common";

type StockRow = { productId: string; productCode: string; warehouseId: string; locationId: string; lot: string | null; serialQtys: number[] };

/** แบ่งจำนวนเป็น SN: ไม่ระบุจำนวนต่อ SN = 1 SN; ระบุ = SN ละเท่านั้น เศษอยู่ SN สุดท้าย */
export function splitSerials(qty: number, perSerial: number | null): number[] {
  if (!perSerial || perSerial >= qty) return [qty];
  const total = toMilli(qty);
  const per = toMilli(perSerial);
  const out: number[] = [];
  for (let left = total; left > 0; left -= per) out.push(fromMilli(Math.min(per, left)));
  return out;
}

const MAX_LINES_PER_RECEIPT = 200;

export const openingStockImporter: Importer<StockRow> = {
  kind: "opening-stock",
  title: "ยอดคงคลังตั้งต้น (ยอดยกมา)",
  description:
    "สร้างใบนำเข้า (ประเภทอื่นๆ) ที่นำเข้าแล้ว แยกตามคลัง + Lot พร้อม Barcode/SN — ใช้ได้เฉพาะสินค้าที่ยังไม่มีความเคลื่อนไหวในคลัง (กันนำเข้าซ้ำ) วันที่มีผลตาม --date",
  columns: [
    { header: "รหัสสินค้า", required: true, example: "BW-DK145-DB", help: "สินค้าที่สต๊อกได้ (นำเข้าสินค้าก่อน)" },
    { header: "รหัสคลัง", required: true, example: "WH1", help: "รหัสคลัง (ระดับ 0) ใน ตั้งค่าคลัง > สถานที่จัดเก็บ" },
    { header: "สถานที่", example: "A > A-1 > A-1-01", help: "รหัสสถานที่ใต้คลัง (ใส่รหัสเดียวได้ถ้าไม่ซ้ำ หรือเส้นทาง A > A-1) ว่าง = เก็บที่ระดับคลัง" },
    { header: "Lot", example: "LOT2026-01", help: "แยกใบนำเข้าตาม Lot" },
    { header: "จำนวน", required: true, example: "120", help: "หน่วยสต๊อกของสินค้า ทศนิยมไม่เกิน 3 ตำแหน่ง" },
    { header: "จำนวนต่อ SN", example: "10", help: "แบ่งเป็นหลาย Barcode/SN (เช่น 120 ÷ 10 = 12 SN) ว่าง = 1 SN" },
  ],

  async plan(records) {
    const errors: RowError[] = [];
    const rows: ImportPlan<StockRow>["rows"] = [];
    const codes = [...new Set(records.map((r) => (r["รหัสสินค้า"] ?? "").toUpperCase()).filter(Boolean))];
    const products = new Map((await prisma.product.findMany({ where: { code: { in: codes } } })).map((p) => [p.code, p]));
    const moved = new Set(
      (await prisma.stockMovement.groupBy({ by: ["productId"], where: { productId: { in: [...products.values()].map((p) => p.id) } } })).map((g) => g.productId),
    );
    const nodes = await prisma.stockLocation.findMany();
    const childrenOf = (id: string) => nodes.filter((n) => n.parentId === id);
    const descendants = (id: string): typeof nodes => childrenOf(id).flatMap((c) => [c, ...descendants(c.id)]);

    for (const [i, r] of records.entries()) {
      const row = csvRow(i);
      const before = errors.length;
      const err = (column: string, message: string) => errors.push({ row, column, message });
      const code = (r["รหัสสินค้า"] ?? "").toUpperCase();
      const p = products.get(code);
      if (!code) err("รหัสสินค้า", "กรุณากรอกรหัสสินค้า");
      else if (!p || p.deletedAt) err("รหัสสินค้า", `ไม่พบสินค้า ${code}`);
      else if (!p.isStockable) err("รหัสสินค้า", `${code} ไม่ใช่สินค้าที่สต๊อกได้`);
      else if (moved.has(p.id)) err("รหัสสินค้า", `${code} มีความเคลื่อนไหวในคลังแล้ว — ยอดยกมานำเข้าได้เฉพาะสินค้าที่ยังไม่มีสต๊อก`);

      const whCode = (r["รหัสคลัง"] ?? "").trim();
      const wh = nodes.find((n) => n.level === 0 && n.code.toUpperCase() === whCode.toUpperCase());
      if (!whCode) err("รหัสคลัง", "กรุณากรอกรหัสคลัง");
      else if (!wh) err("รหัสคลัง", `ไม่พบคลังรหัส ${whCode}`);
      else if (!wh.isActive) err("รหัสคลัง", `คลัง ${whCode} ปิดใช้งานแล้ว`);

      let locationId = wh?.id ?? "";
      const locText = (r["สถานที่"] ?? "").trim();
      if (wh && locText) {
        const path = locText.split(">").map((x) => x.trim().toUpperCase()).filter(Boolean);
        let found: (typeof nodes)[number] | undefined;
        if (path.length > 1) {
          let parent = wh.id;
          for (const c of path) {
            found = childrenOf(parent).find((n) => n.code.toUpperCase() === c);
            if (!found) break;
            parent = found.id;
          }
          if (!found) err("สถานที่", `ไม่พบเส้นทาง "${locText}" ในคลัง ${whCode}`);
        } else {
          const hits = descendants(wh.id).filter((n) => n.code.toUpperCase() === path[0]);
          if (hits.length > 1) err("สถานที่", `รหัส "${locText}" ซ้ำหลายที่ในคลัง ${whCode} — ใส่เส้นทาง เช่น A > A-1`);
          else if (!hits.length) err("สถานที่", `ไม่พบสถานที่ "${locText}" ในคลัง ${whCode}`);
          found = hits[0];
        }
        if (found && !found.isActive) err("สถานที่", `สถานที่ "${locText}" ปิดใช้งานแล้ว`);
        if (found) locationId = found.id;
      }

      const qty = parseQty(r["จำนวน"] ?? "");
      if (qty === null || qty <= 0) err("จำนวน", "จำนวนต้องเป็นตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 3 ตำแหน่ง");
      const perText = r["จำนวนต่อ SN"] ?? "";
      const per = perText ? parseQty(perText) : null;
      if (perText && (per === null || per <= 0)) err("จำนวนต่อ SN", "ต้องเป็นตัวเลขมากกว่า 0");
      if (errors.length > before || !p || !wh || qty === null) continue;

      const serialQtys = splitSerials(qty, per);
      if (serialQtys.length > MAX_SERIALS_PER_BATCH) {
        err("จำนวนต่อ SN", `แถวเดียวสร้างได้ไม่เกิน ${MAX_SERIALS_PER_BATCH} SN (ได้ ${serialQtys.length})`);
        continue;
      }
      rows.push({ row, action: "create", data: { productId: p.id, productCode: code, warehouseId: wh.id, locationId, lot: r["Lot"] || null, serialQtys } });
    }
    const groups = new Set(rows.map((r) => `${r.data.warehouseId}|${r.data.lot ?? ""}`)).size;
    const sn = rows.reduce((n, r) => n + r.data.serialQtys.length, 0);
    return { rows, errors, notes: rows.length ? [`จะสร้างใบนำเข้าอย่างน้อย ${groups} ใบ (แยกตามคลัง + Lot) รวม ${sn} Barcode/SN`] : [] };
  },

  async commit(plan, ctx) {
    const occurredAt = bangkokLocalToDate(`${ctx.date}T00:00`)!;
    // แยกใบตาม คลัง + Lot แล้วแบ่งใบไม่ให้เกินขีดจำกัด SN/รายการต่อใบ
    const groups = new Map<string, StockRow[]>();
    for (const r of plan.rows) {
      const k = `${r.data.warehouseId}|${r.data.lot ?? ""}`;
      groups.set(k, [...(groups.get(k) ?? []), r.data]);
    }
    const docs: string[] = [];
    for (const lines of groups.values()) {
      const chunks: StockRow[][] = [[]];
      let sn = 0;
      for (const l of lines) {
        const cur = chunks[chunks.length - 1];
        if (cur.length && (sn + l.serialQtys.length > MAX_SERIALS_PER_RECEIPT || cur.length >= MAX_LINES_PER_RECEIPT)) {
          chunks.push([]);
          sn = 0;
        }
        chunks[chunks.length - 1].push(l);
        sn += l.serialQtys.length;
      }
      for (const chunk of chunks) {
        const docNo = await prisma.$transaction(async (tx) => {
          const docNo = await allocateDocNumber(tx, DOC_PREFIXES.GOODS_RECEIPT);
          const gr = await tx.goodsReceipt.create({
            data: {
              docNo,
              type: "OTHER",
              docDate: dateOnly(ctx.date),
              warehouseId: chunk[0].warehouseId,
              lot: chunk[0].lot,
              note: `ยอดยกมา — นำเข้าจากไฟล์ ${ctx.source}`,
              createdById: ctx.actor.id,
            },
          });
          let seq = 0;
          const now = new Date();
          for (const [i, l] of chunk.entries()) {
            const line = await tx.goodsReceiptLine.create({ data: { receiptId: gr.id, lineNo: i + 1, productId: l.productId, locationId: l.locationId } });
            await tx.stockSerial.createMany({
              data: l.serialQtys.map((q) => {
                seq++;
                return { barcode: serialBarcode(docNo, seq), seq, productId: l.productId, receiptLineId: line.id, initialQty: q, scannedAt: now, scannedById: ctx.actor.id };
              }),
            });
          }
          await writeAudit(tx, { actorId: ctx.actor.id, entityType: ENTITY_RECEIPT, entityId: gr.id, action: "CREATE", after: await receiptSnapshot(tx, gr.id), note: `ยอดยกมา (${ctx.source})` });
          await postReceipt(tx, gr.id, ctx.actor.id, { occurredAt });
          await writeAudit(tx, { actorId: ctx.actor.id, entityType: ENTITY_RECEIPT, entityId: gr.id, action: "STATUS_CHANGE", note: `นำเข้าคลัง ${seq} SN (ยอดยกมา ณ ${ctx.date})`, force: true });
          return docNo;
        }, { ...STOCK_TX, timeout: 120_000 });
        docs.push(docNo);
      }
    }
    return { created: plan.rows.length, skipped: 0, notes: [`สร้างใบนำเข้า ${docs.length} ใบ: ${docs.join(", ")} (พิมพ์ label ได้จากหน้าใบนำเข้า)`] };
  },
};
