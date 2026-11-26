import { apiHandler, parseListParams, readJson, type ListResult } from "@/lib/api";
import { prisma } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDateTime, fullName } from "@/lib/format";
import { bangkokLocalToDate } from "@/lib/date-input";
import { DELIVERY_STATUS_LABELS, mapHref, type DeliveryStatus } from "@/lib/delivery";
import { ISSUE_TYPE_LABELS } from "@/lib/stock-rules";
import { deliveryJobSchema } from "@/lib/validators";
import { createDelivery, deliveryInclude } from "@/server/deliveries";
import type { Prisma } from "@/generated/prisma/client";

const SORTABLE = ["startAt", "createdAt"];
const STATUSES = Object.keys(DELIVERY_STATUS_LABELS) as DeliveryStatus[];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type DeliveryRow = {
  id: string;
  status: DeliveryStatus;
  startAt: string;
  endAt: string;
  driver: string;
  driverId: string;
  issueId: string;
  issueNo: string;
  customer: string | null;
  shippingAddress: string | null;
  mapHref: string | null;
};

/**
 * รายการงานจัดส่ง: กรอง f_driver (id หรือ "me"), f_status, f_issue, f_from/f_to (วันที่ไทย — งานที่ช่วงจัดส่งซ้อนกับช่วงนี้)
 * ปฏิทินเรียกด้วย pageSize ใหญ่ + ช่วงวันที่ที่แสดง
 */
export const GET = apiHandler({ perm: ["inventory.delivery", "view"] }, async ({ req, user }) => {
  const p = parseListParams(req, SORTABLE);
  const and: Prisma.DeliveryJobWhereInput[] = [];
  const status = STATUSES.find((s) => s === p.filters.status);
  if (status) and.push({ status });
  if (p.filters.driver === "me") and.push({ driverId: user.id });
  else if (p.filters.driver) and.push({ driverId: p.filters.driver });
  if (p.filters.issue) and.push({ goodsIssueId: p.filters.issue });
  const from = ISO.test(p.filters.from ?? "") ? bangkokLocalToDate(`${p.filters.from}T00:00`) : null;
  const to = ISO.test(p.filters.to ?? "") ? bangkokLocalToDate(`${p.filters.to}T00:00`) : null;
  // งานหลายวัน: แสดงถ้าช่วงจัดส่งซ้อนกับช่วงที่กรอง
  if (from) and.push({ endAt: { gte: from } });
  if (to) and.push({ startAt: { lt: new Date(to.getTime() + 24 * 3600_000) } });
  if (p.q) {
    const contains = { contains: p.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { shippingAddress: contains },
        { note: contains },
        { goodsIssue: { docNo: contains } },
        { goodsIssue: { contact: { name: contains } } },
        { goodsIssue: { recipientName: contains } },
        { driver: { OR: [{ firstName: contains }, { lastName: contains }] } },
      ],
    });
  }
  const where: Prisma.DeliveryJobWhereInput = { AND: and };
  const orderBy: Prisma.DeliveryJobOrderByWithRelationInput[] = p.sort ? [{ [p.sort.field]: p.sort.dir }] : [{ startAt: "desc" }];

  if (p.format === "csv") {
    const rows = await prisma.deliveryJob.findMany({ where, orderBy, include: deliveryInclude });
    const csv = toCsv(rows, [
      { header: "วันเวลาเริ่ม", value: (r) => formatDateTime(r.startAt) },
      { header: "วันเวลาสิ้นสุด", value: (r) => formatDateTime(r.endAt) },
      { header: "สถานะ", value: (r) => DELIVERY_STATUS_LABELS[r.status] },
      { header: "พนักงานจัดส่ง", value: (r) => fullName(r.driver) },
      { header: "ใบนำออก", value: (r) => r.goodsIssue.docNo },
      { header: "ประเภทนำออก", value: (r) => ISSUE_TYPE_LABELS[r.goodsIssue.type] },
      { header: "ลูกค้า/ผู้รับ", value: (r) => r.goodsIssue.contact?.name ?? r.goodsIssue.recipientName },
      { header: "ที่อยู่จัดส่ง", value: (r) => r.shippingAddress },
      { header: "ลิงก์/พิกัด Google Map", value: (r) => r.mapUrl },
      { header: "ส่งแล้วเมื่อ", value: (r) => formatDateTime(r.deliveredAt) },
      { header: "หมายเหตุ", value: (r) => r.note },
    ]);
    return csvResponse(csv, "deliveries.csv");
  }

  const [total, rows] = await Promise.all([
    prisma.deliveryJob.count({ where }),
    prisma.deliveryJob.findMany({ where, orderBy, include: deliveryInclude, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  return {
    rows: rows.map(
      (r): DeliveryRow => ({
        id: r.id,
        status: r.status,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        driver: fullName(r.driver),
        driverId: r.driverId,
        issueId: r.goodsIssueId,
        issueNo: r.goodsIssue.docNo,
        customer: r.goodsIssue.contact?.name ?? r.goodsIssue.recipientName ?? null,
        shippingAddress: r.shippingAddress,
        mapHref: mapHref(r.mapUrl),
      }),
    ),
    total,
    page: p.page,
    pageSize: p.pageSize,
  } satisfies ListResult<DeliveryRow>;
});

export const POST = apiHandler({ perm: ["inventory.delivery", "create"] }, async ({ req, user, ip }) => {
  const j = await createDelivery(user, deliveryJobSchema.parse(await readJson(req)), ip);
  return { id: j.id };
});
