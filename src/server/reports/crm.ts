import "server-only";
import { prisma } from "@/lib/db";
import { formatAddress } from "@/lib/address";
import { formatDateTime, formatTime, fullName } from "@/lib/format";
import { PROJECT_STATUS_LABELS, WORK_PLAN_STATUS_LABELS, type ProjectStatus } from "@/lib/crm";
import { CHANNEL_LABELS } from "@/lib/validators";
import { todayBangkok, dateOnly } from "@/lib/stock-rules";
import type { ReportResult, ReportRow } from "@/lib/reports";
import type { Prisma } from "@/generated/prisma/client";
import type { ChannelType } from "@/generated/prisma/enums";
import { d, dateRangeFilter, dayRange, enumOptions, money, qty, selectFilter, timeRange, userOptions, type Filters, type ReportDef } from "./common";

const ROLE_OPTIONS = [
  { value: "customer", label: "ลูกค้า" },
  { value: "vendor", label: "ผู้ขาย" },
];
const roleWhere = (f: Filters): Prisma.ContactWhereInput => (f.role === "customer" ? { isCustomer: true } : f.role === "vendor" ? { isVendor: true } : {});
const roles = (c: { isCustomer: boolean; isVendor: boolean }) => [c.isCustomer && "ลูกค้า", c.isVendor && "ผู้ขาย"].filter(Boolean).join(", ");
const channelOf = (chs: { type: ChannelType; value: string }[], types: ChannelType[]) => chs.filter((c) => types.includes(c.type)).map((c) => c.value).join(", ");

async function lookupOptions(kind: "CUSTOMER_BUSINESS_TYPE") {
  const xs = await prisma.lookupOption.findMany({ where: { kind }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  return xs.map((x) => ({ value: x.id, label: x.label }));
}

const contacts: ReportDef = {
  key: "contacts",
  title: "รายงานผู้ติดต่อ",
  description: "ผู้ติดต่อทั้งหมดพร้อมช่องทางติดต่อ ที่อยู่ กลุ่ม และจำนวนโครงการ",
  filters: async () => [
    dateRangeFilter("วันที่สร้าง", true),
    selectFilter("role", "ประเภท", ROLE_OPTIONS),
    selectFilter("businessType", "ประเภทกิจการของลูกค้า", await lookupOptions("CUSTOMER_BUSINESS_TYPE")),
  ],
  run: async (f) => {
    const rows = await prisma.contact.findMany({
      where: { deletedAt: null, ...roleWhere(f), createdAt: timeRange(f), customerBusinessTypeId: f.businessType || undefined },
      include: {
        channels: { orderBy: { sortOrder: "asc" } },
        tags: { include: { tag: true } },
        source: true,
        customerBusinessType: true,
        _count: { select: { projects: { where: { deletedAt: null } }, persons: true } },
      },
      orderBy: { code: "asc" },
    });
    return {
      columns: [
        { key: "code", header: "รหัส" },
        { key: "roles", header: "ประเภท" },
        { key: "name", header: "ชื่อ" },
        { key: "entityType", header: "ประเภทกิจการ" },
        { key: "businessType", header: "ประเภทกิจการของลูกค้า" },
        { key: "taxId", header: "เลขประจำตัวผู้เสียภาษี" },
        { key: "branch", header: "สาขา" },
        { key: "source", header: "ช่องทางที่รู้จัก" },
        { key: "tags", header: "กลุ่ม" },
        { key: "phone", header: "โทรศัพท์" },
        { key: "email", header: "อีเมล" },
        { key: "line", header: "LINE" },
        { key: "otherChannels", header: "ช่องทางอื่น" },
        { key: "address", header: "ที่อยู่จดทะเบียน" },
        { key: "province", header: "จังหวัด" },
        { key: "persons", header: "บุคคลติดต่อ", type: "number" },
        { key: "projects", header: "จำนวนโครงการ", type: "number" },
        { key: "createdAt", header: "วันที่สร้าง" },
      ],
      rows: rows.map((c) => ({
        code: c.code,
        roles: roles(c),
        name: c.name,
        entityType: c.entityType === "JURISTIC" ? "นิติบุคคล" : "บุคคลธรรมดา",
        businessType: c.customerBusinessType?.label ?? null,
        taxId: c.taxId,
        branch: c.branch,
        source: c.source?.label ?? null,
        tags: c.tags.map((t) => t.tag.name).join(", "),
        phone: channelOf(c.channels, ["PHONE", "MOBILE"]),
        email: channelOf(c.channels, ["EMAIL"]),
        line: channelOf(c.channels, ["LINE"]),
        otherChannels: c.channels
          .filter((ch) => !["PHONE", "MOBILE", "EMAIL", "LINE"].includes(ch.type))
          .map((ch) => `${CHANNEL_LABELS[ch.type]}: ${ch.value}`)
          .join(", "),
        address: formatAddress({
          address: c.regAddress,
          houseNo: c.regHouseNo,
          moo: c.regMoo,
          soi: c.regSoi,
          road: c.regRoad,
          subdistrict: c.regSubdistrict,
          district: c.regDistrict,
          province: c.regProvince,
          postalCode: c.regPostalCode,
          country: c.regCountry,
        }),
        province: c.regProvince,
        persons: c._count.persons,
        projects: c._count.projects,
        createdAt: d(c.createdAt),
      })),
    };
  },
};

const projects: ReportDef = {
  key: "projects",
  title: "รายงานโครงการ",
  description: "โครงการตามสถานะ พนักงานขาย มูลค่า และโอกาสสำเร็จ",
  filters: async () => [
    dateRangeFilter("วันที่สร้างโครงการ", true),
    selectFilter("status", "สถานะ", enumOptions(PROJECT_STATUS_LABELS)),
    selectFilter("salesRep", "พนักงานขาย", await userOptions()),
  ],
  run: async (f) => {
    const status = f.status in PROJECT_STATUS_LABELS ? (f.status as ProjectStatus) : undefined;
    const rows = await prisma.project.findMany({
      where: { deletedAt: null, status, salesRepId: f.salesRep || undefined, createdAt: timeRange(f) },
      include: {
        customer: { select: { code: true, name: true } },
        salesRep: { select: { firstName: true, lastName: true } },
        businessType: true,
        workStage: true,
        workNature: true,
        tags: { include: { tag: true } },
        _count: { select: { engineerDocs: { where: { status: { not: "CANCELLED" } } }, workPlans: { where: { status: { not: "CANCELLED" } } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    const out: ReportRow[] = rows.map((p) => ({
      name: p.name,
      customer: `${p.customer.code} ${p.customer.name}`,
      contactPerson: p.contactPerson,
      salesRep: p.salesRep ? fullName(p.salesRep) : null,
      status: PROJECT_STATUS_LABELS[p.status],
      businessType: p.businessType?.label ?? null,
      workStage: p.workStage?.label ?? null,
      workNature: p.workNature?.label ?? null,
      workDetail: p.workDetail,
      probability: p.probability,
      expectedCloseDate: d(p.expectedCloseDate),
      value: money(p.value?.toString()),
      tags: p.tags.map((t) => t.tag.name).join(", "),
      engineerDocs: p._count.engineerDocs,
      workPlans: p._count.workPlans,
      createdAt: d(p.createdAt),
    }));
    return {
      columns: [
        { key: "name", header: "ชื่อโครงการ" },
        { key: "customer", header: "ลูกค้า" },
        { key: "contactPerson", header: "บุคคลติดต่อ" },
        { key: "salesRep", header: "พนักงานขาย" },
        { key: "status", header: "สถานะ" },
        { key: "businessType", header: "ประเภทกิจการ" },
        { key: "workStage", header: "ขั้นตอนของงาน" },
        { key: "workNature", header: "ลักษณะงาน" },
        { key: "workDetail", header: "ข้อมูลลักษณะงาน" },
        { key: "probability", header: "% โอกาสสำเร็จ", type: "number" },
        { key: "expectedCloseDate", header: "วันคาดการณ์ปิดดีล" },
        { key: "value", header: "มูลค่า", type: "number", decimals: 2 },
        { key: "tags", header: "กลุ่ม" },
        { key: "engineerDocs", header: "ใบถอดแบบ", type: "number" },
        { key: "workPlans", header: "แผนการทำงาน", type: "number" },
        { key: "createdAt", header: "วันที่สร้าง" },
      ],
      rows: out,
      totals: { name: `รวม ${out.length} โครงการ`, value: money(out.reduce((s, r) => s + Number(r.value ?? 0), 0)) },
    };
  },
};

const persons: ReportDef = {
  key: "persons",
  title: "รายงานบุคคลติดต่อ",
  description: "บุคคลติดต่อของผู้ติดต่อทุกราย (ชื่อ ตำแหน่ง เบอร์ อีเมล LINE)",
  filters: async () => [selectFilter("role", "ประเภทผู้ติดต่อ", ROLE_OPTIONS)],
  run: async (f) => {
    const rows = await prisma.contactPerson.findMany({
      where: { contact: { deletedAt: null, ...roleWhere(f) } },
      include: { contact: { select: { code: true, name: true, isCustomer: true, isVendor: true } } },
      orderBy: [{ contact: { code: "asc" } }, { isPrimary: "desc" }, { sortOrder: "asc" }],
    });
    return {
      columns: [
        { key: "contactCode", header: "รหัสผู้ติดต่อ" },
        { key: "contactName", header: "ผู้ติดต่อ" },
        { key: "roles", header: "ประเภท" },
        { key: "name", header: "ชื่อบุคคลติดต่อ" },
        { key: "position", header: "ตำแหน่ง" },
        { key: "phone", header: "เบอร์โทร" },
        { key: "email", header: "อีเมล" },
        { key: "lineId", header: "LINE" },
        { key: "primary", header: "ผู้ติดต่อหลัก" },
        { key: "note", header: "หมายเหตุ" },
      ],
      rows: rows.map((p) => ({
        contactCode: p.contact.code,
        contactName: p.contact.name,
        roles: roles(p.contact),
        name: p.name,
        position: p.position,
        phone: p.phone,
        email: p.email,
        lineId: p.lineId,
        primary: p.isPrimary ? "ใช่" : "",
        note: p.note,
      })),
    };
  },
};

const workPlans: ReportDef = {
  key: "work-plans",
  title: "รายงานตารางทำงานและระยะทาง",
  description: "แผนการทำงาน เช็คอิน และระยะทาง ต่อพนักงาน ต่อช่วงวันที่ (สรุป หรือ รายละเอียด)",
  filters: async () => [
    dateRangeFilter("วันที่ (วันเวลาเริ่มของแผน)"),
    selectFilter("employee", "พนักงาน", await userOptions()),
    {
      id: "view",
      type: "select",
      label: "มุมมอง",
      required: true,
      defaultValue: "summary",
      options: [
        { value: "summary", label: "สรุปต่อพนักงาน" },
        { value: "detail", label: "รายละเอียดทุกแผน" },
      ],
    },
  ],
  run: async (f): Promise<ReportResult> => {
    const plans = await prisma.workPlan.findMany({
      where: { plannedStart: timeRange(f), employeeId: f.employee || undefined },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        customer: { select: { name: true } },
        project: { select: { name: true } },
      },
      orderBy: [{ plannedStart: "asc" }],
    });
    const km = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

    if (f.view === "detail") {
      const rows: ReportRow[] = plans.map((p) => ({
        date: d(p.plannedStart),
        time: `${formatTime(p.plannedStart)}–${formatTime(p.plannedEnd)}`,
        employee: fullName(p.employee),
        subject: p.subject,
        customer: p.customer?.name ?? null,
        project: p.project?.name ?? null,
        location: p.location,
        status: WORK_PLAN_STATUS_LABELS[p.status],
        startAt: p.startAt ? formatDateTime(p.startAt) : null,
        startPoint: p.startLat === null ? null : `${p.startLat},${p.startLng}`,
        endAt: p.endAt ? formatDateTime(p.endAt) : null,
        endPoint: p.endLat === null ? null : `${p.endLat},${p.endLng}`,
        distanceKm: p.distanceKm === null ? null : qty(p.distanceKm.toString()),
      }));
      return {
        columns: [
          { key: "date", header: "วันที่" },
          { key: "time", header: "เวลา (วางแผน)" },
          { key: "employee", header: "พนักงาน" },
          { key: "subject", header: "เรื่อง" },
          { key: "customer", header: "ลูกค้า" },
          { key: "project", header: "โครงการ" },
          { key: "location", header: "สถานที่" },
          { key: "status", header: "สถานะ" },
          { key: "startAt", header: "เช็คอินจุดเริ่มต้น" },
          { key: "startPoint", header: "พิกัดจุดเริ่มต้น" },
          { key: "endAt", header: "เช็คอินจุดหมาย" },
          { key: "endPoint", header: "พิกัดจุดหมาย" },
          { key: "distanceKm", header: "ระยะทาง (กม.)", type: "number", decimals: 2 },
        ],
        rows,
        totals: { date: `รวม ${rows.length} แผน`, distanceKm: qty(plans.reduce((s, p) => s + km(p.distanceKm), 0)) },
      };
    }

    type Agg = { employee: string; total: number; planned: number; checkedIn: number; done: number; cancelled: number; measured: number; distanceKm: number };
    const by = new Map<string, Agg>();
    for (const p of plans) {
      const a = by.get(p.employeeId) ?? { employee: fullName(p.employee), total: 0, planned: 0, checkedIn: 0, done: 0, cancelled: 0, measured: 0, distanceKm: 0 };
      a.total++;
      if (p.status === "PLANNED") a.planned++;
      if (p.status === "CHECKED_IN") a.checkedIn++;
      if (p.status === "DONE") a.done++;
      if (p.status === "CANCELLED") a.cancelled++;
      if (p.distanceKm !== null) {
        a.measured++;
        a.distanceKm += km(p.distanceKm);
      }
      by.set(p.employeeId, a);
    }
    const rows = [...by.values()].sort((a, b) => a.employee.localeCompare(b.employee, "th")).map((a) => ({ ...a, distanceKm: qty(a.distanceKm) }));
    const sum = (k: keyof Agg) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    return {
      columns: [
        { key: "employee", header: "พนักงาน" },
        { key: "total", header: "จำนวนแผน", type: "number" },
        { key: "planned", header: "วางแผน", type: "number" },
        { key: "checkedIn", header: "เช็คอิน", type: "number" },
        { key: "done", header: "เสร็จสิ้น", type: "number" },
        { key: "cancelled", header: "ยกเลิก", type: "number" },
        { key: "measured", header: "แผนที่มีระยะทาง", type: "number" },
        { key: "distanceKm", header: "ระยะทางรวม (กม.)", type: "number", decimals: 2 },
      ],
      rows,
      totals: {
        employee: "รวม",
        total: sum("total"),
        planned: sum("planned"),
        checkedIn: sum("checkedIn"),
        done: sum("done"),
        cancelled: sum("cancelled"),
        measured: sum("measured"),
        distanceKm: qty(sum("distanceKm")),
      },
    };
  },
};

const WARRANTY_STATUS = { active: "อยู่ในประกัน", expiring: "ใกล้หมดประกัน (≤ 30 วัน)", expired: "หมดประกันแล้ว" } as const;

const warranty: ReportDef = {
  key: "warranty",
  title: "รายงานการรับประกัน",
  description: "โครงการที่มีข้อมูลการรับประกัน พร้อมจำนวนวันคงเหลือ (สถานะคิด ณ วันนี้)",
  filters: async () => [dateRangeFilter("วันสิ้นสุดการรับประกัน", true), selectFilter("warranty", "สถานะการรับประกัน", enumOptions(WARRANTY_STATUS))],
  run: async (f) => {
    const today = dateOnly(todayBangkok());
    const rows = await prisma.project.findMany({
      where: { deletedAt: null, OR: [{ warrantyStart: { not: null } }, { warrantyEnd: { not: null } }], warrantyEnd: dayRange(f) },
      include: { customer: { select: { code: true, name: true } }, salesRep: { select: { firstName: true, lastName: true } } },
      orderBy: [{ warrantyEnd: "asc" }, { name: "asc" }],
    });
    const out = rows
      .map((p) => {
        const days = p.warrantyEnd ? Math.round((p.warrantyEnd.getTime() - today.getTime()) / 86400_000) : null;
        const st: keyof typeof WARRANTY_STATUS | null = days === null ? "active" : days < 0 ? "expired" : days <= 30 ? "expiring" : "active";
        return { p, days, st };
      })
      .filter((x) => !f.warranty || x.st === f.warranty);
    return {
      columns: [
        { key: "project", header: "โครงการ" },
        { key: "customer", header: "ลูกค้า" },
        { key: "salesRep", header: "พนักงานขาย" },
        { key: "projectStatus", header: "สถานะโครงการ" },
        { key: "warrantyStart", header: "วันเริ่มรับประกัน" },
        { key: "warrantyEnd", header: "วันสิ้นสุดรับประกัน" },
        { key: "daysLeft", header: "คงเหลือ (วัน)", type: "number" },
        { key: "warrantyStatus", header: "สถานะการรับประกัน" },
        { key: "note", header: "หมายเหตุ" },
      ],
      rows: out.map(({ p, days, st }) => ({
        project: p.name,
        customer: `${p.customer.code} ${p.customer.name}`,
        salesRep: p.salesRep ? fullName(p.salesRep) : null,
        projectStatus: PROJECT_STATUS_LABELS[p.status],
        warrantyStart: d(p.warrantyStart),
        warrantyEnd: d(p.warrantyEnd),
        daysLeft: days === null ? null : Math.max(days, 0),
        warrantyStatus: st ? WARRANTY_STATUS[st] : null,
        note: p.warrantyNote,
      })),
    };
  },
};

export const CRM_REPORTS: ReportDef[] = [contacts, projects, persons, workPlans, warranty];
