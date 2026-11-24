import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime } from "@/lib/format";
import { dateRangeFilter } from "@/lib/list-filters";
import { STATUS_LABELS, type PurchaseStatus } from "@/lib/approval";
import { VAT_MODE_LABELS } from "@/lib/purchase-calc";
import { poLineReceived } from "@/lib/purchase-status";
import { purchaseOrderSchema } from "@/lib/validators";
import { createOrder } from "@/server/purchase-orders";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["docNo", "docDate", "deliveryDate", "total", "createdAt"];
const STATUSES = Object.keys(STATUS_LABELS.PO) as PurchaseStatus[];

export type OrderRow = {
  id: string;
  docNo: string;
  docDate: string;
  deliveryDate: string | null;
  vendor: string;
  products: string;
  total: number;
  status: PurchaseStatus;
  createdAt: string;
};

const include = {
  vendor: { select: { code: true, name: true } },
  warehouse: true,
  lines: {
    orderBy: { lineNo: "asc" },
    include: { product: { include: { stockUnit: true } }, requestLine: { include: { request: { select: { docNo: true } } } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

export const GET = apiHandler({ perm: ["purchase.order", "view"] }, async ({ req }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.PurchaseOrderWhereInput[] = [];
  const status = STATUSES.find((s) => s === p.filters.status);
  if (status) and.push({ status });
  if (p.filters.vendor) and.push({ vendorId: p.filters.vendor });
  const range = dateRangeFilter(p.filters);
  if (range) and.push({ docDate: range });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { docNo: contains },
        { reference: contains },
        { note: contains },
        { vendor: { OR: [{ name: contains }, { code: contains }] } },
        { lines: { some: { OR: [{ product: { OR: [{ code: contains }, { name: contains }] } }, { requestLine: { request: { docNo: contains } } }] } } },
      ],
    });
  }
  const where: Prisma.PurchaseOrderWhereInput = { AND: and };
  const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: p.sort.dir }] : [{ docDate: "desc" }, { docNo: "desc" }];

  if (p.format === "csv") {
    const docs = await prisma.purchaseOrder.findMany({ where, orderBy, include });
    const received = await poLineReceived(prisma, docs.flatMap((d) => d.lines.map((l) => l.id)));
    type Doc = (typeof docs)[number];
    const rows = docs.flatMap((d): { d: Doc; l: Doc["lines"][number] | null }[] => (d.lines.length ? d.lines.map((l) => ({ d, l })) : [{ d, l: null }]));
    const csv = toCsv(rows, [
      { header: "เลขที่เอกสาร", value: (r) => r.d.docNo },
      { header: "วันที่", value: (r) => formatDate(r.d.docDate) },
      { header: "วันที่ส่งของ", value: (r) => formatDate(r.d.deliveryDate) },
      { header: "รหัสผู้ขาย", value: (r) => r.d.vendor.code },
      { header: "ผู้ขาย", value: (r) => r.d.vendor.name },
      { header: "สถานะ", value: (r) => STATUS_LABELS.PO[r.d.status] },
      { header: "ใบขอซื้อ", value: (r) => r.l?.requestLine?.request.docNo },
      { header: "รหัสสินค้า", value: (r) => r.l?.product.code },
      { header: "ชื่อสินค้า", value: (r) => r.l?.product.name },
      { header: "จำนวน", value: (r) => r.l?.quantity.toString() },
      { header: "หน่วย", value: (r) => r.l?.product.stockUnit?.name },
      { header: "ราคาต่อหน่วย", value: (r) => r.l?.unitPrice.toString() },
      { header: "ส่วนลด", value: (r) => r.l?.discount.toString() },
      { header: "จำนวนเงิน", value: (r) => r.l?.amount.toString() },
      { header: "นำเข้าแล้ว", value: (r) => (r.l ? (received.get(r.l.id) ?? 0) : "") },
      { header: "VAT", value: (r) => VAT_MODE_LABELS[r.d.vatMode] },
      { header: "ยอดรวมทั้งใบ", value: (r) => r.d.total.toString() },
      { header: "เงื่อนไขการชำระ", value: (r) => r.d.paymentTerms },
      { header: "วันที่สร้าง", value: (r) => formatDateTime(r.d.createdAt) },
    ]);
    return csvResponse(csv, "purchase-orders.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): OrderRow => ({
        id: r.id,
        docNo: r.docNo,
        docDate: r.docDate.toISOString(),
        deliveryDate: r.deliveryDate?.toISOString() ?? null,
        vendor: r.vendor.name,
        products: [...new Set(r.lines.map((l) => l.product.code))].join(", "),
        total: Number(r.total),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<OrderRow>;
});

export const POST = apiHandler({ perm: ["purchase.order", "create"] }, async ({ req, user, ip }) => {
  const o = await createOrder(user, purchaseOrderSchema.parse(await readJson(req)), ip);
  return { id: o.id, docNo: o.docNo };
});
