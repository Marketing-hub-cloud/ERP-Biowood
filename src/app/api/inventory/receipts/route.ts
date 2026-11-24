import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { dateRangeFilter } from "@/lib/list-filters";
import { RECEIPT_STATUS_LABELS, RECEIPT_TYPE_LABELS, sumQty } from "@/lib/stock-rules";
import { receiptSchema } from "@/lib/validators";
import { createReceipt } from "@/server/goods-receipts";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["docNo", "docDate", "createdAt"];

export type ReceiptRow = {
  id: string;
  docNo: string;
  docDate: string;
  type: keyof typeof RECEIPT_TYPE_LABELS;
  warehouse: string;
  lot: string | null;
  products: string;
  lineCount: number;
  serialCount: number;
  status: keyof typeof RECEIPT_STATUS_LABELS;
  createdBy: string;
  createdAt: string;
};

const include = {
  warehouse: true,
  createdBy: { select: { firstName: true, lastName: true } },
  lines: { orderBy: { lineNo: "asc" }, include: { product: { select: { code: true } }, _count: { select: { serials: true } } } },
} satisfies Prisma.GoodsReceiptInclude;
type Row = Prisma.GoodsReceiptGetPayload<{ include: typeof include }>;

const toRow = (r: Row): ReceiptRow => ({
  id: r.id,
  docNo: r.docNo,
  docDate: r.docDate.toISOString(),
  type: r.type,
  warehouse: r.warehouse.name,
  lot: r.lot,
  products: r.lines.map((l) => l.product.code).join(", "),
  lineCount: r.lines.length,
  serialCount: r.lines.reduce((n, l) => n + l._count.serials, 0),
  status: r.status,
  createdBy: fullName(r.createdBy),
  createdAt: r.createdAt.toISOString(),
});

export const GET = apiHandler({ perm: ["inventory.receipt", "view"] }, async ({ req }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.GoodsReceiptWhereInput[] = [];
  if (p.filters.type === "PURCHASE" || p.filters.type === "OTHER") and.push({ type: p.filters.type });
  if (p.filters.status === "DRAFT" || p.filters.status === "POSTED" || p.filters.status === "CANCELLED") and.push({ status: p.filters.status });
  if (p.filters.warehouse) and.push({ warehouseId: p.filters.warehouse });
  const range = dateRangeFilter(p.filters);
  if (range) and.push({ docDate: range });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { docNo: contains },
        { lot: contains },
        { note: contains },
        { lines: { some: { OR: [{ product: { code: contains } }, { product: { name: contains } }, { serials: { some: { barcode: contains } } }] } } },
      ],
    });
  }
  const where: Prisma.GoodsReceiptWhereInput = { AND: and };
  const orderBy: Prisma.GoodsReceiptOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: p.sort.dir }] : [{ docDate: "desc" }, { docNo: "desc" }];

  if (p.format === "csv") {
    // 1 แถวต่อรายการสินค้า
    const docs = await prisma.goodsReceipt.findMany({
      where,
      orderBy,
      include: {
        warehouse: true,
        createdBy: { select: { firstName: true, lastName: true } },
        lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } }, location: true, serials: { select: { initialQty: true } } } },
      },
    });
    type Doc = (typeof docs)[number];
    const rows = docs.flatMap((d): { d: Doc; l: Doc["lines"][number] | null }[] => (d.lines.length ? d.lines.map((l) => ({ d, l })) : [{ d, l: null }]));
    const csv = toCsv(rows, [
      { header: "เลขที่เอกสาร", value: (r) => r.d.docNo },
      { header: "วันที่", value: (r) => formatDate(r.d.docDate) },
      { header: "ประเภท", value: (r) => RECEIPT_TYPE_LABELS[r.d.type] },
      { header: "คลัง", value: (r) => r.d.warehouse.name },
      { header: "Lot", value: (r) => r.d.lot },
      { header: "สถานะ", value: (r) => RECEIPT_STATUS_LABELS[r.d.status] },
      { header: "รหัสสินค้า", value: (r) => r.l?.product.code },
      { header: "ชื่อสินค้า", value: (r) => r.l?.product.name },
      { header: "สถานที่", value: (r) => r.l?.location?.name },
      { header: "จำนวน SN", value: (r) => r.l?.serials.length },
      { header: "จำนวน", value: (r) => (r.l ? sumQty(r.l.serials.map((s) => s.initialQty.toString())) : "") },
      { header: "หน่วย", value: (r) => r.l?.product.stockUnit?.name },
      { header: "หมายเหตุ", value: (r) => r.d.note },
      { header: "ผู้สร้าง", value: (r) => fullName(r.d.createdBy) },
      { header: "วันที่สร้าง", value: (r) => formatDateTime(r.d.createdAt) },
    ]);
    return csvResponse(csv, "goods-receipts.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.goodsReceipt.count({ where }),
    prisma.goodsReceipt.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return { rows: rows.map(toRow), total, page: p.page, pageSize: p.pageSize } satisfies ListResult<ReceiptRow>;
});

export const POST = apiHandler({ perm: ["inventory.receipt", "create"] }, async ({ req, user, ip }) => {
  const r = await createReceipt(user, receiptSchema.parse(await readJson(req)), ip);
  return { id: r.id, docNo: r.docNo };
});
