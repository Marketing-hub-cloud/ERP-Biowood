import "server-only";
import { prisma } from "@/lib/db";
import { parseDate, parseNumber, splitList } from "@/lib/csv-parse";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/crm";
import { projectSchema, type ProjectInput } from "@/lib/validators";
import { createProject } from "@/server/projects";
import { csvRow, errorText, headerFor, LookupResolver, tagIds, type ImportPlan, type Importer, type RowError } from "./common";

type ProjectRow = { input: ProjectInput; businessType: string; workStage: string; workNature: string; tags: string[] };

const STATUS_BY_LABEL = new Map(Object.entries(PROJECT_STATUS_LABELS).map(([k, v]) => [v, k as ProjectStatus]));

export const projectsImporter: Importer<ProjectRow> & { lookups?: LookupResolver } = {
  kind: "projects",
  title: "โครงการ (CRM)",
  description: "1 แถว = โครงการ 1 โครงการ อ้างลูกค้าด้วยรหัสผู้ติดต่อ (นำเข้าผู้ติดต่อก่อน) — ชื่อโครงการซ้ำกับของลูกค้าเดียวกันจะข้าม",
  columns: [
    { header: "ชื่อโครงการ", required: true, example: "บ้านคุณสมชาย ราชพฤกษ์", help: "" },
    { header: "รหัสลูกค้า", required: true, example: "C0001", help: "รหัสผู้ติดต่อที่เป็นลูกค้า" },
    { header: "สถานะ", example: "เสนอราคา", help: `${Object.values(PROJECT_STATUS_LABELS).join(" / ")} (ว่าง = โครงการใหม่)` },
    { header: "บุคคลติดต่อ", example: "คุณสมชาย", help: "ข้อความ" },
    { header: "พนักงานขาย", example: "sales@biowood.co.th", help: "อีเมลผู้ใช้ในระบบ (สร้างผู้ใช้ก่อน)" },
    { header: "ประเภทกิจการ", example: "บ้านส่วนตัว", help: "ไม่มีในระบบ = สร้างตัวเลือกใหม่" },
    { header: "ขั้นตอนของงาน", example: "ก่อสร้าง", help: "ไม่มีในระบบ = สร้างตัวเลือกใหม่" },
    { header: "ลักษณะงาน", example: "เทียบสเปค", help: "ไม่มีในระบบ = สร้างตัวเลือกใหม่" },
    { header: "ข้อมูลลักษณะงาน", example: "ไม้พื้นรุ่น DK145", help: "" },
    { header: "% โอกาสสำเร็จ", example: "50", help: "10, 20, … 100 (มี % ได้)" },
    { header: "วันคาดการณ์ปิดดีล", example: "31/12/2026", help: "DD/MM/YYYY (ปี พ.ศ. ได้)" },
    { header: "มูลค่า", example: "192,085", help: "ตัวเลข มี comma ได้" },
    { header: "กลุ่ม", example: "", help: "หลายกลุ่มคั่นด้วย ," },
    { header: "วันเริ่มรับประกัน", example: "", help: "DD/MM/YYYY" },
    { header: "วันสิ้นสุดรับประกัน", example: "", help: "DD/MM/YYYY" },
    { header: "หมายเหตุการรับประกัน", example: "", help: "" },
    { header: "หมายเหตุ", example: "", help: "" },
  ],

  async plan(records) {
    const lookups = new LookupResolver();
    this.lookups = lookups;
    const errors: RowError[] = [];
    const rows: ImportPlan<ProjectRow>["rows"] = [];
    const codes = [...new Set(records.map((r) => (r["รหัสลูกค้า"] ?? "").toUpperCase()).filter(Boolean))];
    const customers = new Map((await prisma.contact.findMany({ where: { code: { in: codes }, deletedAt: null } })).map((c) => [c.code, c]));
    const users = new Map((await prisma.user.findMany({ where: { status: "ACTIVE" } })).map((u) => [u.email.toLowerCase(), u.id]));
    const existing = new Set(
      (await prisma.project.findMany({ where: { deletedAt: null }, select: { name: true, customerId: true } })).map((p) => `${p.customerId}|${p.name.trim().toLowerCase()}`),
    );
    const inFile = new Map<string, number>();

    for (const [i, r] of records.entries()) {
      const row = csvRow(i);
      const before = errors.length;
      const err = (column: string, message: string) => errors.push({ row, column, message });
      const code = (r["รหัสลูกค้า"] ?? "").toUpperCase();
      const c = customers.get(code);
      if (!code) err("รหัสลูกค้า", "กรุณากรอกรหัสลูกค้า");
      else if (!c) err("รหัสลูกค้า", `ไม่พบผู้ติดต่อรหัส ${code}`);
      else if (!c.isCustomer) err("รหัสลูกค้า", `${code} ไม่ได้เป็นลูกค้า`);
      const statusLabel = r["สถานะ"] ?? "";
      const status = statusLabel ? STATUS_BY_LABEL.get(statusLabel) : "NEW";
      if (!status) err("สถานะ", `ไม่รู้จักสถานะ "${statusLabel}"`);
      const email = (r["พนักงานขาย"] ?? "").toLowerCase();
      const salesRepId = email ? users.get(email) : null;
      if (email && !salesRepId) err("พนักงานขาย", `ไม่พบผู้ใช้ ${email} (หรือถูกหยุดใช้งาน)`);
      const dates: Record<string, string | null> = {};
      for (const h of ["วันคาดการณ์ปิดดีล", "วันเริ่มรับประกัน", "วันสิ้นสุดรับประกัน"]) {
        const d = parseDate(r[h] ?? "");
        if (d === undefined) err(h, "วันที่ไม่ถูกต้อง (ใช้ DD/MM/YYYY)");
        dates[h] = d ?? null;
      }
      const prob = parseNumber((r["% โอกาสสำเร็จ"] ?? "").replace("%", ""));
      if (prob === undefined) err("% โอกาสสำเร็จ", "ต้องเป็นตัวเลข");
      const value = parseNumber(r["มูลค่า"] ?? "");
      if (value === undefined) err("มูลค่า", "ต้องเป็นตัวเลข");

      const input: ProjectInput = {
        name: r["ชื่อโครงการ"] ?? "",
        status: status ?? "NEW",
        customerId: c?.id ?? "pending",
        contactPerson: r["บุคคลติดต่อ"] || null,
        salesRepId: salesRepId ?? null,
        workDetail: r["ข้อมูลลักษณะงาน"] || null,
        probability: prob ?? null,
        expectedCloseDate: dates["วันคาดการณ์ปิดดีล"],
        value: value === null || value === undefined ? null : String(value),
        tagIds: [],
        warrantyStart: dates["วันเริ่มรับประกัน"],
        warrantyEnd: dates["วันสิ้นสุดรับประกัน"],
        warrantyNote: r["หมายเหตุการรับประกัน"] || null,
        note: r["หมายเหตุ"] || null,
      };
      const parsed = projectSchema.safeParse(input);
      if (!parsed.success) for (const iss of parsed.error.issues)
          err(
            headerFor(iss.path, {
              name: "ชื่อโครงการ",
              probability: "% โอกาสสำเร็จ",
              value: "มูลค่า",
              contactPerson: "บุคคลติดต่อ",
              workDetail: "ข้อมูลลักษณะงาน",
              warrantyEnd: "วันสิ้นสุดรับประกัน",
              warrantyNote: "หมายเหตุการรับประกัน",
              note: "หมายเหตุ",
            }),
            iss.message,
          );
      if (errors.length > before || !c || !parsed.success) continue;

      const key = `${c.id}|${parsed.data.name.toLowerCase()}`;
      if (inFile.has(key)) {
        err("ชื่อโครงการ", `ซ้ำกับแถว ${inFile.get(key)} (ลูกค้าเดียวกัน)`);
        continue;
      }
      inFile.set(key, row);
      await lookups.note("CUSTOMER_BUSINESS_TYPE", r["ประเภทกิจการ"] ?? "");
      await lookups.note("PROJECT_WORK_STAGE", r["ขั้นตอนของงาน"] ?? "");
      await lookups.note("PROJECT_WORK_NATURE", r["ลักษณะงาน"] ?? "");
      const data = { input, businessType: r["ประเภทกิจการ"] ?? "", workStage: r["ขั้นตอนของงาน"] ?? "", workNature: r["ลักษณะงาน"] ?? "", tags: splitList(r["กลุ่ม"] ?? "") };
      rows.push(existing.has(key) ? { row, data, action: "skip", note: `${code} มีโครงการ "${parsed.data.name}" อยู่แล้ว` } : { row, data, action: "create" });
    }
    return {
      rows,
      errors,
      notes: lookups.describe({ CUSTOMER_BUSINESS_TYPE: "ประเภทกิจการ", PROJECT_WORK_STAGE: "ขั้นตอนของงาน", PROJECT_WORK_NATURE: "ลักษณะงาน" }),
    };
  },

  async commit(plan, ctx) {
    const lookups = this.lookups ?? new LookupResolver();
    let created = 0;
    for (const r of plan.rows.filter((x) => x.action === "create")) {
      const data = projectSchema.parse({
        ...r.data.input,
        businessTypeId: await lookups.id(prisma, "CUSTOMER_BUSINESS_TYPE", r.data.businessType),
        workStageId: await lookups.id(prisma, "PROJECT_WORK_STAGE", r.data.workStage),
        workNatureId: await lookups.id(prisma, "PROJECT_WORK_NATURE", r.data.workNature),
        tagIds: await tagIds(r.data.tags),
      });
      try {
        await createProject(ctx.actor, data, null);
        created++;
      } catch (e) {
        throw new Error(`แถว ${r.row}: ${errorText(e)} (นำเข้าไปแล้ว ${created} โครงการ)`);
      }
    }
    return { created, skipped: plan.rows.length - created, notes: [] };
  },
};
