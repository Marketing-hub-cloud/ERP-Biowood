import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { dateRangeFilter } from "@/lib/list-filters";
import { STATUS_LABELS, type PurchaseStatus } from "@/lib/approval";
import { prLineOrdered } from "@/lib/purchase-status";
import { purchaseRequestSchema } from "@/lib/validators";
import { createRequest } from "@/server/purchase-requests";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["docNo", "docDate", "requiredDate", "createdAt"];
const STATUSES = Object.keys(STATUS_LABELS.PR) as PurchaseStatus[];

export type RequestRow = {
  id: string;
  docNo: string;
  docDate: string;
  requiredDate: string | null;
  requester: string;
  department: string | null;
  products: string;
  lineCount: number;
  status: PurchaseStatus;
  createdAt: string;
};

const include = {
  requester: { select: { firstName: true, lastName: true } },
  lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } },
  warehouse: true,
} satisfies Prisma.PurchaseRequestInclude;

export const GET = apiHandler({ perm: ["purchase.request", "view"] }, async ({ req }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.PurchaseRequestWhereInput[] = [];
  const status = STATUSES.find((s) => s === p.filters.status);
  if (status) and.push({ status });
  const range = dateRangeFilter(p.filters);
  if (range) and.push({ docDate: range });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { docNo: contains },
        { reference: contains },
        { note: contains },
        { department: contains },
        { requester: { OR: [{ firstName: contains }, { lastName: contains }] } },
        { lines: { some: { product: { OR: [{ code: contains }, { name: contains }] } } } },
      ],
    });
  }
  const where: Prisma.PurchaseRequestWhereInput = { AND: and };
  const orderBy: Prisma.PurchaseRequestOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: p.sort.dir }] : [{ docDate: "desc" }, { docNo: "desc" }];

  if (p.format === "csv") {
    const docs = await prisma.purchaseRequest.findMany({ where, orderBy, include });
    const ordered = await prLineOrdered(prisma, docs.flatMap((d) => d.lines.map((l) => l.id)));
    type Doc = (typeof docs)[number];
    const rows = docs.flatMap((d): { d: Doc; l: Doc["lines"][number] | null }[] => (d.lines.length ? d.lines.map((l) => ({ d, l })) : [{ d, l: null }]));
    const csv = toCsv(rows, [
      { header: "เลขที่เอกสาร", value: (r) => r.d.docNo },
      { header: "วันที่", value: (r) => formatDate(r.d.docDate) },
      { header: "ต้องการภายในวันที่", value: (r) => formatDate(r.d.requiredDate) },
      { header: "ผู้ขอ", value: (r) => fullName(r.d.requester) },
      { header: "แผนก", value: (r) => r.d.department },
      { header: "คลังปลายทาง", value: (r) => r.d.warehouse?.name },
      { header: "สถานะ", value: (r) => STATUS_LABELS.PR[r.d.status] },
      { header: "รหัสสินค้า", value: (r) => r.l?.product.code },
      { header: "ชื่อสินค้า", value: (r) => r.l?.product.name },
      { header: "จำนวน", value: (r) => r.l?.quantity.toString() },
      { header: "หน่วย", value: (r) => r.l?.product.stockUnit?.name },
      { header: "สั่งซื้อแล้ว", value: (r) => (r.l ? (ordered.get(r.l.id) ?? 0) : "") },
      { header: "เอกสารอ้างอิง", value: (r) => r.d.reference },
      { header: "หมายเหตุ", value: (r) => r.d.note },
      { header: "วันที่สร้าง", value: (r) => formatDateTime(r.d.createdAt) },
    ]);
    return csvResponse(csv, "purchase-requests.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.purchaseRequest.count({ where }),
    prisma.purchaseRequest.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): RequestRow => ({
        id: r.id,
        docNo: r.docNo,
        docDate: r.docDate.toISOString(),
        requiredDate: r.requiredDate?.toISOString() ?? null,
        requester: fullName(r.requester),
        department: r.department,
        products: [...new Set(r.lines.map((l) => l.product.code))].join(", "),
        lineCount: r.lines.length,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<RequestRow>;
});

export const POST = apiHandler({ perm: ["purchase.request", "create"] }, async ({ req, user, ip }) => {
  const r = await createRequest(user, purchaseRequestSchema.parse(await readJson(req)), ip);
  return { id: r.id, docNo: r.docNo };
});
