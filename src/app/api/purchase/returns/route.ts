import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime } from "@/lib/format";
import { dateRangeFilter } from "@/lib/list-filters";
import { STATUS_LABELS, type PurchaseStatus } from "@/lib/approval";
import { rtLineIssued } from "@/lib/purchase-status";
import { purchaseReturnSchema } from "@/lib/validators";
import { createReturn } from "@/server/purchase-returns";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["docNo", "docDate", "createdAt"];
const STATUSES = Object.keys(STATUS_LABELS.RT) as PurchaseStatus[];

export type ReturnRow = {
  id: string;
  docNo: string;
  docDate: string;
  orderDocNo: string;
  vendor: string;
  reason: string;
  products: string;
  status: PurchaseStatus;
  createdAt: string;
};

const include = {
  order: { select: { docNo: true } },
  vendor: { select: { code: true, name: true } },
  reason: true,
  lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } },
} satisfies Prisma.PurchaseReturnInclude;

export const GET = apiHandler({ perm: ["purchase.return", "view"] }, async ({ req }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.PurchaseReturnWhereInput[] = [];
  const status = STATUSES.find((s) => s === p.filters.status);
  if (status) and.push({ status });
  const range = dateRangeFilter(p.filters);
  if (range) and.push({ docDate: range });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { docNo: contains },
        { note: contains },
        { order: { docNo: contains } },
        { vendor: { OR: [{ name: contains }, { code: contains }] } },
        { lines: { some: { product: { OR: [{ code: contains }, { name: contains }] } } } },
      ],
    });
  }
  const where: Prisma.PurchaseReturnWhereInput = { AND: and };
  const orderBy: Prisma.PurchaseReturnOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: p.sort.dir }] : [{ docDate: "desc" }, { docNo: "desc" }];

  if (p.format === "csv") {
    const docs = await prisma.purchaseReturn.findMany({ where, orderBy, include });
    const issued = await rtLineIssued(prisma, docs.flatMap((d) => d.lines.map((l) => l.id)));
    type Doc = (typeof docs)[number];
    const rows = docs.flatMap((d): { d: Doc; l: Doc["lines"][number] | null }[] => (d.lines.length ? d.lines.map((l) => ({ d, l })) : [{ d, l: null }]));
    const csv = toCsv(rows, [
      { header: "เลขที่เอกสาร", value: (r) => r.d.docNo },
      { header: "วันที่", value: (r) => formatDate(r.d.docDate) },
      { header: "ใบสั่งซื้อ", value: (r) => r.d.order.docNo },
      { header: "ผู้ขาย", value: (r) => r.d.vendor.name },
      { header: "เหตุผล", value: (r) => r.d.reason.label },
      { header: "สถานะ", value: (r) => STATUS_LABELS.RT[r.d.status] },
      { header: "รหัสสินค้า", value: (r) => r.l?.product.code },
      { header: "ชื่อสินค้า", value: (r) => r.l?.product.name },
      { header: "จำนวนคืน", value: (r) => r.l?.quantity.toString() },
      { header: "หน่วย", value: (r) => r.l?.product.stockUnit?.name },
      { header: "นำออกแล้ว", value: (r) => (r.l ? (issued.get(r.l.id) ?? 0) : "") },
      { header: "หมายเหตุ", value: (r) => r.d.note },
      { header: "วันที่สร้าง", value: (r) => formatDateTime(r.d.createdAt) },
    ]);
    return csvResponse(csv, "purchase-returns.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.purchaseReturn.count({ where }),
    prisma.purchaseReturn.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): ReturnRow => ({
        id: r.id,
        docNo: r.docNo,
        docDate: r.docDate.toISOString(),
        orderDocNo: r.order.docNo,
        vendor: r.vendor.name,
        reason: r.reason.label,
        products: [...new Set(r.lines.map((l) => l.product.code))].join(", "),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<ReturnRow>;
});

export const POST = apiHandler({ perm: ["purchase.return", "create"] }, async ({ req, user, ip }) => {
  const r = await createReturn(user, purchaseReturnSchema.parse(await readJson(req)), ip);
  return { id: r.id, docNo: r.docNo };
});
