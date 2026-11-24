import { z } from "zod";
import { ApiError, apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { dateRangeFilter } from "@/lib/list-filters";
import { ISSUE_STATUS_LABELS, ISSUE_TYPE_LABELS, sumQty } from "@/lib/stock-rules";
import { issueSchema } from "@/lib/validators";
import { createIssue } from "@/server/goods-issues";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["docNo", "docDate", "createdAt"];
const TYPES = Object.keys(ISSUE_TYPE_LABELS) as (keyof typeof ISSUE_TYPE_LABELS)[];

export type IssueRow = {
  id: string;
  docNo: string;
  docDate: string;
  type: keyof typeof ISSUE_TYPE_LABELS;
  recipient: string;
  products: string;
  lineCount: number;
  totalQty: number;
  status: keyof typeof ISSUE_STATUS_LABELS;
  createdBy: string;
  createdAt: string;
};

const include = {
  contact: { select: { code: true, name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } }, serial: { select: { barcode: true, lot: true } } } },
} satisfies Prisma.GoodsIssueInclude;
type Row = Prisma.GoodsIssueGetPayload<{ include: typeof include }>;

const recipientOf = (r: Row) => r.contact?.name ?? r.recipientName ?? "";
const uniqueCodes = (r: Row) => [...new Set(r.lines.map((l) => l.product.code))].join(", ");

export const GET = apiHandler({ perm: ["inventory.issue", "view"] }, async ({ req }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.GoodsIssueWhereInput[] = [];
  const type = TYPES.find((t) => t === p.filters.type);
  if (type) and.push({ type });
  if (p.filters.status === "DRAFT" || p.filters.status === "POSTED" || p.filters.status === "CANCELLED") and.push({ status: p.filters.status });
  const range = dateRangeFilter(p.filters);
  if (range) and.push({ docDate: range });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { docNo: contains },
        { recipientName: contains },
        { note: contains },
        { contact: { name: contains } },
        { lines: { some: { OR: [{ product: { code: contains } }, { product: { name: contains } }, { serial: { barcode: contains } }] } } },
      ],
    });
  }
  const where: Prisma.GoodsIssueWhereInput = { AND: and };
  const orderBy: Prisma.GoodsIssueOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: p.sort.dir }] : [{ docDate: "desc" }, { docNo: "desc" }];

  if (p.format === "csv") {
    const docs = await prisma.goodsIssue.findMany({ where, orderBy, include });
    type Doc = (typeof docs)[number];
    const rows = docs.flatMap((d): { d: Doc; l: Doc["lines"][number] | null }[] => (d.lines.length ? d.lines.map((l) => ({ d, l })) : [{ d, l: null }]));
    const csv = toCsv(rows, [
      { header: "เลขที่เอกสาร", value: (r) => r.d.docNo },
      { header: "วันที่", value: (r) => formatDate(r.d.docDate) },
      { header: "ประเภท", value: (r) => ISSUE_TYPE_LABELS[r.d.type] },
      { header: "ลูกค้า/ผู้รับ", value: (r) => recipientOf(r.d) },
      { header: "สถานะ", value: (r) => ISSUE_STATUS_LABELS[r.d.status] },
      { header: "SN / Barcode", value: (r) => r.l?.serial.barcode },
      { header: "Lot", value: (r) => r.l?.serial.lot },
      { header: "รหัสสินค้า", value: (r) => r.l?.product.code },
      { header: "ชื่อสินค้า", value: (r) => r.l?.product.name },
      { header: "จำนวน", value: (r) => r.l?.quantity.toString() },
      { header: "หน่วย", value: (r) => r.l?.product.stockUnit?.name },
      { header: "ที่อยู่จัดส่ง", value: (r) => r.d.shippingAddress },
      { header: "หมายเหตุ", value: (r) => r.d.note },
      { header: "ผู้สร้าง", value: (r) => fullName(r.d.createdBy) },
      { header: "วันที่สร้าง", value: (r) => formatDateTime(r.d.createdAt) },
    ]);
    return csvResponse(csv, "goods-issues.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.goodsIssue.count({ where }),
    prisma.goodsIssue.findMany({ where, orderBy, include, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): IssueRow => ({
        id: r.id,
        docNo: r.docNo,
        docDate: r.docDate.toISOString(),
        type: r.type,
        recipient: recipientOf(r),
        products: uniqueCodes(r),
        lineCount: r.lines.length,
        totalQty: sumQty(r.lines.map((l) => l.quantity.toString())),
        status: r.status,
        createdBy: fullName(r.createdBy),
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<IssueRow>;
});

/** สร้างใบนำออก: body + { post?: true } = นำออกทันที (ต้องมีสิทธิ์แก้ไขด้วย) */
export const POST = apiHandler({ perm: ["inventory.issue", "create"] }, async ({ req, user, ip }) => {
  const body = await readJson(req);
  const post = z.object({ post: z.boolean().optional() }).parse(body).post ?? false;
  if (post && !can(user.permissions, "inventory.issue", "edit")) throw new ApiError(403, "ไม่มีสิทธิ์นำออก");
  const doc = await createIssue(user, issueSchema.parse(body), post, ip);
  return { id: doc.id, docNo: doc.docNo };
});
