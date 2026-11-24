// Zod schemas — ใช้ร่วมกันทั้งฝั่ง client และ server
import { z } from "zod";
import { PERMISSION_MENU_KEYS } from "./menu";
import { MAX_SERIALS_PER_BATCH, parseQty, QTY_DECIMALS } from "./stock-rules";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const required = (label: string, max = 200) =>
  z.string({ error: `กรุณากรอก${label}` }).trim().min(1, `กรุณากรอก${label}`).max(max);

export const PASSWORD_MIN = 8;
const password = z.string().min(PASSWORD_MIN, `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`).max(100);

const userBase = {
  email: z.string().trim().toLowerCase().pipe(z.email("รูปแบบอีเมลไม่ถูกต้อง")),
  firstName: required("ชื่อ", 100),
  lastName: required("นามสกุล", 100),
  department: optionalText,
  position: optionalText,
  isAdmin: z.boolean().optional(),
  groupIds: z.array(z.string()).optional(),
};

const passwordsMatch = (d: { password?: string; confirmPassword?: string }) => (d.password ?? "") === (d.confirmPassword ?? "");
const MATCH_MSG = { message: "ยืนยันรหัสผ่านไม่ตรงกัน", path: ["confirmPassword"] };

export const userCreateSchema = z
  .object({ ...userBase, password, confirmPassword: z.string() })
  .refine(passwordsMatch, MATCH_MSG);
export type UserCreateInput = z.input<typeof userCreateSchema>;

/** แก้ไขผู้ใช้: เว้นรหัสผ่านว่าง = ไม่เปลี่ยน */
export const userUpdateSchema = z
  .object({
    ...userBase,
    password: z.union([z.literal(""), password]).optional(),
    confirmPassword: z.string().optional(),
  })
  .refine(passwordsMatch, MATCH_MSG);
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

export const userStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  statusNote: required("หมายเหตุสถานะ", 500),
});

export const profileSchema = z.object({
  firstName: userBase.firstName,
  lastName: userBase.lastName,
  department: optionalText,
  position: optionalText,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน"),
    password,
    confirmPassword: z.string(),
  })
  .refine(passwordsMatch, MATCH_MSG);

const flags = z.object({
  view: z.boolean(),
  create: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  cancel: z.boolean(),
});

export const groupSchema = z.object({
  name: required("ชื่อกลุ่มสิทธิ์", 100),
  description: optionalText,
  permissions: z.record(z.string(), flags).refine((p) => Object.keys(p).every((k) => PERMISSION_MENU_KEYS.includes(k)), {
    message: "มีเมนูที่ไม่รู้จัก",
  }),
  memberIds: z.array(z.string()),
});
export type GroupInput = z.input<typeof groupSchema>;

export const companySchema = z.object({
  nameTh: required("ชื่อบริษัท (ไทย)"),
  nameEn: optionalText,
  address: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  taxId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{13}$/.test(v), "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก"),
  branch: optionalText,
  phone: optionalText,
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "รูปแบบอีเมลไม่ถูกต้อง"),
  website: optionalText,
});
export type CompanyInput = z.input<typeof companySchema>;

// ───────────────────────── ผู้ติดต่อ (เฟส 2) ─────────────────────────

const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `ยาวได้ไม่เกิน ${max} ตัวอักษร`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const CHANNEL_TYPES = ["PHONE", "MOBILE", "EMAIL", "LINE", "FACEBOOK", "WEBSITE", "FAX", "OTHER"] as const;
export const CHANNEL_LABELS: Record<(typeof CHANNEL_TYPES)[number], string> = {
  PHONE: "โทรศัพท์",
  MOBILE: "มือถือ",
  EMAIL: "อีเมล",
  LINE: "LINE",
  FACEBOOK: "Facebook",
  WEBSITE: "เว็บไซต์",
  FAX: "แฟกซ์",
  OTHER: "อื่นๆ",
};

const addressFields = {
  address: text(300),
  houseNo: text(50),
  moo: text(20),
  soi: text(100),
  road: text(100),
  subdistrict: text(100),
  district: text(100),
  province: text(100),
  postalCode: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[0-9A-Za-z -]{3,10}$/.test(v), "รหัสไปรษณีย์ไม่ถูกต้อง"),
  country: z
    .string()
    .trim()
    .max(100)
    .optional()
    .nullable()
    .transform((v) => (v ? v : "ไทย")),
};
export const addressSchema = z.object(addressFields);

const isEmail = (v: string) => z.email().safeParse(v).success;

export const contactSchema = z
  .object({
    code: z
      .string()
      .trim()
      .max(20, "รหัสยาวได้ไม่เกิน 20 ตัวอักษร")
      .optional()
      .nullable()
      .transform((v) => (v ? v.toUpperCase() : null))
      .refine((v) => v === null || /^[A-Z0-9_-]+$/.test(v), "รหัสใช้ได้เฉพาะ A-Z, 0-9, - และ _"),
    isCustomer: z.boolean(),
    isVendor: z.boolean(),
    entityType: z.enum(["JURISTIC", "INDIVIDUAL"]),
    name: required("ชื่อ", 255),
    taxId: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v ? v.replace(/[\s-]/g, "") : null))
      .refine((v) => v === null || /^\d{13}$/.test(v), "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก"),
    branch: text(100),
    sourceId: text(50),
    customerBusinessTypeId: text(50),
    note: text(2000),
    reg: addressSchema,
    shippingAddresses: z
      .array(
        z.object({
          ...addressFields,
          label: text(100),
          recipient: text(200),
          phone: text(50),
          isDefault: z.boolean().optional().default(false),
        }),
      )
      .max(50),
    channels: z
      .array(
        z
          .object({
            type: z.enum(CHANNEL_TYPES),
            value: z.string().trim().min(1, "กรุณากรอกข้อมูลช่องทางติดต่อ").max(255),
            note: text(200),
          })
          .refine((c) => c.type !== "EMAIL" || isEmail(c.value), { message: "รูปแบบอีเมลไม่ถูกต้อง", path: ["value"] }),
      )
      .max(50),
    persons: z
      .array(
        z.object({
          name: z.string().trim().min(1, "กรุณากรอกชื่อบุคคลติดต่อ").max(200),
          position: text(100),
          phone: text(50),
          email: text(255).refine((v) => v === null || isEmail(v), "รูปแบบอีเมลไม่ถูกต้อง"),
          lineId: text(100),
          note: text(500),
          isPrimary: z.boolean().optional().default(false),
        }),
      )
      .max(100),
    tagIds: z.array(z.string()).max(50),
  })
  .refine((c) => c.isCustomer || c.isVendor, {
    message: "กรุณาเลือกประเภทผู้ติดต่ออย่างน้อย 1 ประเภท (ลูกค้า/ผู้ขาย)",
    path: ["isCustomer"],
  });
export type ContactInput = z.input<typeof contactSchema>;
export type ContactData = z.output<typeof contactSchema>;

export const lookupSchema = z.object({
  kind: z.enum(["CONTACT_SOURCE", "CUSTOMER_BUSINESS_TYPE", "PRODUCT_TYPE"]),
  label: required("ชื่อตัวเลือก", 100),
});

export const tagSchema = z.object({ name: required("ชื่อกลุ่ม", 50) });

// ───────────────────────── ตั้งค่าคลัง + สินค้า (เฟส 3) ─────────────────────────

export const treeNodeSchema = z.object({
  parentId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  code: z
    .string()
    .trim()
    .max(30, "รหัสยาวได้ไม่เกิน 30 ตัวอักษร")
    .optional()
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z0-9_.\-/]+$/.test(v), "รหัสใช้ได้เฉพาะ A-Z, 0-9 และ - _ . /"),
  name: required("ชื่อ", 100),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
});
export type TreeNodeInput = z.input<typeof treeNodeSchema>;

export const unitSchema = z.object({
  name: required("ชื่อหน่วย", 30),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
});

export const ATTRIBUTE_TYPE_LABELS = { TEXT: "ข้อความ", NUMBER: "ตัวเลข", SELECT: "ตัวเลือก" } as const;

export const attributeSchema = z
  .object({
    name: required("ชื่อคุณสมบัติ", 100),
    dataType: z.enum(["TEXT", "NUMBER", "SELECT"]),
    options: z
      .array(z.string().trim().min(1).max(100))
      .max(100)
      .optional()
      .default([])
      .transform((o) => [...new Set(o)]),
    unitLabel: text(20),
    isRequired: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
  })
  .refine((a) => a.dataType !== "SELECT" || a.options.length > 0, { message: "กรุณาเพิ่มตัวเลือกอย่างน้อย 1 รายการ", path: ["options"] })
  .transform((a) => ({ ...a, options: a.dataType === "SELECT" ? a.options : [], unitLabel: a.dataType === "NUMBER" ? a.unitLabel : null }));
export type AttributeInput = z.input<typeof attributeSchema>;

export const productSchema = z
  .object({
    code: z
      .string({ error: "กรุณากรอกรหัสสินค้า" })
      .trim()
      .min(1, "กรุณากรอกรหัสสินค้า")
      .max(50, "รหัสยาวได้ไม่เกิน 50 ตัวอักษร")
      .transform((v) => v.toUpperCase())
      .refine((v) => /^[A-Z0-9_.\-/]+$/.test(v), "รหัสใช้ได้เฉพาะ A-Z, 0-9 และ - _ . /"),
    name: required("ชื่อสินค้า", 255),
    productTypeId: text(50),
    categoryId: text(50),
    description: text(5000),
    isStockable: z.boolean(),
    stockUnitId: text(50),
    isActive: z.boolean().optional().default(true),
    /** attributeId -> ค่า (ข้อความ) */
    attributes: z.record(z.string(), z.string().trim().max(500)).optional().default({}),
  })
  .refine((p) => !p.isStockable || p.stockUnitId, { message: "กรุณาเลือกหน่วยสต๊อก", path: ["stockUnitId"] });
export type ProductInput = z.input<typeof productSchema>;
export type ProductData = z.output<typeof productSchema>;

// ───────────────────────── เฟส 4: นำเข้า / นำออก ─────────────────────────

const qty = (label = "จำนวน") =>
  z
    .union([z.number(), z.string()], { error: `กรุณากรอก${label}` })
    .transform((v, ctx) => {
      const n = parseQty(v);
      if (n === null) {
        ctx.addIssue({ code: "custom", message: `${label}ต้องเป็นตัวเลข ทศนิยมไม่เกิน ${QTY_DECIMALS} ตำแหน่ง` });
        return z.NEVER;
      }
      return n;
    })
    .refine((n) => n > 0, `${label}ต้องมากกว่า 0`)
    .refine((n) => n < 1e11, `${label}มากเกินไป`);

const docDate = z
  .string({ error: "กรุณาเลือกวันที่เอกสาร" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "กรุณาเลือกวันที่เอกสาร")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "วันที่ไม่ถูกต้อง");

export const receiptLineSchema = z.object({
  id: z.string().optional().nullable(),
  productId: z.string({ error: "กรุณาเลือกสินค้า" }).min(1, "กรุณาเลือกสินค้า"),
  locationId: text(50),
  note: text(500),
});

export const receiptSchema = z.object({
  type: z.enum(["PURCHASE", "OTHER"]).default("OTHER"),
  docDate,
  warehouseId: z.string({ error: "กรุณาเลือกคลัง" }).min(1, "กรุณาเลือกคลัง"),
  lot: text(100),
  note: text(2000),
  lines: z.array(receiptLineSchema).max(200, "ไม่เกิน 200 รายการ").default([]),
});
export type ReceiptInput = z.input<typeof receiptSchema>;
export type ReceiptData = z.output<typeof receiptSchema>;

export const generateSerialsSchema = z.object({
  count: z.coerce
    .number({ error: "กรุณากรอกจำนวน SN" })
    .int("จำนวน SN ต้องเป็นจำนวนเต็ม")
    .min(1, "จำนวน SN ต้องตั้งแต่ 1")
    .max(MAX_SERIALS_PER_BATCH, `สร้างได้ครั้งละไม่เกิน ${MAX_SERIALS_PER_BATCH} SN`),
  qtyPerSerial: qty("จำนวนต่อ SN"),
});

export const scanSchema = z.object({ barcode: z.string().trim().min(1, "กรุณาสแกน barcode").max(100) });

export const cancelDocSchema = z.object({ reason: required("เหตุผลการยกเลิก", 500) });

export const issueLineSchema = z.object({
  serialId: z.string().min(1),
  quantity: qty(),
  note: text(500),
});

export const issueSchema = z
  .object({
    type: z.enum(["SALE", "RETURN", "SAMPLE", "OTHER"], { error: "กรุณาเลือกประเภท" }),
    docDate,
    contactId: text(50),
    recipientName: text(200),
    shippingAddress: text(1000),
    note: text(2000),
    lines: z.array(issueLineSchema).max(500, "ไม่เกิน 500 รายการ").default([]),
  })
  .refine((d) => d.type !== "SALE" || d.contactId, { message: "ประเภทขายต้องเลือกลูกค้า", path: ["contactId"] })
  .refine((d) => new Set(d.lines.map((l) => l.serialId)).size === d.lines.length, { message: "มี SN ซ้ำในรายการ", path: ["lines"] });
export type IssueInput = z.input<typeof issueSchema>;
export type IssueData = z.output<typeof issueSchema>;
