// Zod schemas — ใช้ร่วมกันทั้งฝั่ง client และ server
import { z } from "zod";
import { PERMISSION_MENU_KEYS } from "./menu";
import { MAX_SERIALS_PER_BATCH, parseQty, QTY_DECIMALS } from "./stock-rules";
import { bangkokLocalToDate } from "./date-input";

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
  approve: z.boolean().optional().default(false),
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
  kind: z.enum(["CONTACT_SOURCE", "CUSTOMER_BUSINESS_TYPE", "PRODUCT_TYPE", "RETURN_REASON", "PROJECT_WORK_STAGE", "PROJECT_WORK_NATURE"]),
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
  orderLineId: text(50),
  productId: z.string({ error: "กรุณาเลือกสินค้า" }).min(1, "กรุณาเลือกสินค้า"),
  locationId: text(50),
  note: text(500),
});

export const receiptSchema = z.object({
  type: z.enum(["PURCHASE", "OTHER"]).default("OTHER"),
  purchaseOrderId: text(50),
  docDate,
  warehouseId: z.string({ error: "กรุณาเลือกคลัง" }).min(1, "กรุณาเลือกคลัง"),
  lot: text(100),
  note: text(2000),
  lines: z.array(receiptLineSchema).max(200, "ไม่เกิน 200 รายการ").default([]),
})
  .refine((d) => d.type !== "PURCHASE" || d.purchaseOrderId, { message: "กรุณาเลือกใบสั่งซื้อ", path: ["purchaseOrderId"] })
  .refine((d) => d.type !== "PURCHASE" || d.lines.every((l) => l.orderLineId), { message: "รายการต้องมาจากใบสั่งซื้อ", path: ["lines"] });
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
    purchaseReturnId: text(50),
    recipientName: text(200),
    shippingAddress: text(1000),
    note: text(2000),
    lines: z.array(issueLineSchema).max(500, "ไม่เกิน 500 รายการ").default([]),
  })
  .refine((d) => d.type !== "SALE" || d.contactId, { message: "ประเภทขายต้องเลือกลูกค้า", path: ["contactId"] })
  .refine((d) => d.type !== "RETURN" || d.purchaseReturnId, { message: "กรุณาเลือกใบส่งคืน", path: ["purchaseReturnId"] })
  .refine((d) => new Set(d.lines.map((l) => l.serialId)).size === d.lines.length, { message: "มี SN ซ้ำในรายการ", path: ["lines"] });
export type IssueInput = z.input<typeof issueSchema>;
export type IssueData = z.output<typeof issueSchema>;

// ───────────────────────── เฟส 5: จัดซื้อ ─────────────────────────

const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "วันที่ไม่ถูกต้อง");

const money = (label: string, decimals = 2) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return 0;
      const s = String(v).replace(/,/g, "").trim();
      if (!/^\d+(\.\d+)?$/.test(s) || (s.split(".")[1] ?? "").length > decimals) {
        ctx.addIssue({ code: "custom", message: `${label}ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน ${decimals} ตำแหน่ง` });
        return z.NEVER;
      }
      return Number(s);
    })
    .refine((n) => n < 1e11, `${label}มากเกินไป`);

export const requestLineSchema = z.object({
  productId: z.string({ error: "กรุณาเลือกสินค้า" }).min(1, "กรุณาเลือกสินค้า"),
  quantity: qty(),
  note: text(500),
});

export const purchaseRequestSchema = z.object({
  docDate,
  requiredDate: optionalDate,
  requesterId: z.string({ error: "กรุณาเลือกผู้ขอ" }).min(1, "กรุณาเลือกผู้ขอ"),
  department: text(100),
  position: text(100),
  reference: text(200),
  warehouseId: text(50),
  note: text(2000),
  lines: z.array(requestLineSchema).min(1, "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ").max(200, "ไม่เกิน 200 รายการ"),
});
export type PurchaseRequestInput = z.input<typeof purchaseRequestSchema>;
export type PurchaseRequestData = z.output<typeof purchaseRequestSchema>;

export const orderLineSchema = z.object({
  productId: z.string({ error: "กรุณาเลือกสินค้า" }).min(1, "กรุณาเลือกสินค้า"),
  requestLineId: text(50),
  quantity: qty(),
  unitPrice: money("ราคาต่อหน่วย", 4),
  discount: money("ส่วนลด"),
  note: text(500),
});

export const purchaseOrderSchema = z.object({
  docDate,
  deliveryDate: optionalDate,
  vendorId: z.string({ error: "กรุณาเลือกผู้ขาย" }).min(1, "กรุณาเลือกผู้ขาย"),
  paymentTerms: text(200),
  reference: text(200),
  warehouseId: text(50),
  note: text(2000),
  vatMode: z.enum(["EXCLUSIVE", "INCLUSIVE", "NONE"]).default("EXCLUSIVE"),
  headerDiscount: money("ส่วนลดท้ายบิล"),
  lines: z
    .array(orderLineSchema)
    .min(1, "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ")
    .max(200, "ไม่เกิน 200 รายการ")
    .refine((ls) => {
      const ids = ls.map((l) => l.requestLineId).filter(Boolean);
      return new Set(ids).size === ids.length;
    }, "มีรายการ PR ซ้ำกัน"),
});
export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;
export type PurchaseOrderData = z.output<typeof purchaseOrderSchema>;

export const returnLineSchema = z.object({
  orderLineId: z.string().min(1),
  quantity: qty("จำนวนที่คืน"),
  note: text(500),
});

export const purchaseReturnSchema = z.object({
  docDate,
  orderId: z.string({ error: "กรุณาเลือกใบสั่งซื้อ" }).min(1, "กรุณาเลือกใบสั่งซื้อ"),
  reasonId: z.string({ error: "กรุณาเลือกเหตุผลการคืน" }).min(1, "กรุณาเลือกเหตุผลการคืน"),
  note: text(2000),
  lines: z
    .array(returnLineSchema)
    .min(1, "กรุณาระบุจำนวนที่คืนอย่างน้อย 1 รายการ")
    .refine((ls) => new Set(ls.map((l) => l.orderLineId)).size === ls.length, "มีรายการซ้ำกัน"),
});
export type PurchaseReturnInput = z.input<typeof purchaseReturnSchema>;
export type PurchaseReturnData = z.output<typeof purchaseReturnSchema>;

export const approvalActionSchema = z.object({
  action: z.enum(["submit", "approve", "reject", "cancel"]),
  comment: z.string().trim().max(1000).optional().nullable(),
});

export const approvalConfigSchema = z.object({
  steps: z.array(z.array(z.string().min(1)).max(50)).max(3, "ตั้งได้สูงสุด 3 ลำดับ"),
});

export const NOTE_MODULES = { purchase: "จัดซื้อ" } as const;

export const noteTemplateSchema = z.object({
  module: z.enum(Object.keys(NOTE_MODULES) as [keyof typeof NOTE_MODULES]),
  title: required("ชื่อหมายเหตุ", 100),
  body: required("ข้อความ", 5000),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
});
export type NoteTemplateInput = z.input<typeof noteTemplateSchema>;

// ───────────────────────── เฟส 6: แจ้งเตือน ─────────────────────────

export const notificationSettingSchema = z
  .object({
    module: z.enum(["purchase", "engineer"]),
    lineEnabled: z.boolean(),
    lineGroupId: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^[A-Za-z0-9]{10,64}$/.test(v), "groupId ไม่ถูกต้อง (เช่น C1234...)"),
  })
  .refine((d) => !d.lineEnabled || d.lineGroupId, { message: "กรุณาระบุกลุ่ม LINE", path: ["lineGroupId"] });

export const markReadSchema = z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() });

// ───────────────────────── เฟส 7: ถอดแบบ/ติดตั้ง ─────────────────────────

export const estimateLineSchema = z.object({
  productId: z.string({ error: "กรุณาเลือกสินค้า" }).min(1, "กรุณาเลือกสินค้า"),
  quantity: qty(),
  note: text(500),
});

export const engineerDocSchema = z
  .object({
    docDate,
    startDate: optionalDate,
    dueDate: optionalDate,
    revision: z.coerce.number({ error: "ครั้งที่ต้องเป็นตัวเลข" }).int("ครั้งที่ต้องเป็นจำนวนเต็ม").min(1, "ครั้งที่ต้องตั้งแต่ 1").max(999),
    workTypes: z
      .array(z.enum(["SURVEY", "INSTALL", "CHANGE"]))
      .min(1, "กรุณาเลือกประเภทงานอย่างน้อย 1 ประเภท")
      .transform((xs) => [...new Set(xs)]),
    workDetail: text(2000),
    projectName: required("ชื่อโครงการ", 255),
    urgency: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
    customerId: text(50),
    addressLabel: text(200),
    siteAddress: text(1000),
    assigneeId: text(50),
    projectId: text(50),
    participantIds: z.array(z.string().min(1)).max(50).default([]).transform((xs) => [...new Set(xs)]),
    note: text(2000),
    estimateLines: z.array(estimateLineSchema).max(200, "ไม่เกิน 200 รายการ").default([]),
  })
  .refine((d) => !d.startDate || !d.dueDate || d.dueDate >= d.startDate, { message: "วันที่กำหนดส่งต้องไม่ก่อนวันที่เริ่มงาน", path: ["dueDate"] });
export type EngineerDocInput = z.input<typeof engineerDocSchema>;
export type EngineerDocData = z.output<typeof engineerDocSchema>;

export const engineerActionSchema = z.object({
  action: z.enum(["advance", "cancel"]),
  /** ขั้นที่ผู้ใช้เห็นตอนกด (กันกดซ้ำ/กดพร้อมกัน) */
  from: z.enum(["DRAFT", "NEW", "REVIEWED", "QUEUED", "ASSIGNED", "IN_PROGRESS", "INSPECTION", "ESTIMATE", "COMPLETED", "CANCELLED"]).optional(),
  comment: z.string().trim().max(1000).optional().nullable(),
});

// ───────────────────────── เฟส 8: CRM ─────────────────────────

const money2 = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const s = String(v).replace(/,/g, "").trim();
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      ctx.addIssue({ code: "custom", message: "มูลค่าต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง" });
      return z.NEVER;
    }
    return Number(s);
  })
  .refine((n) => n === null || n < 1e12, "มูลค่ามากเกินไป");

export const projectSchema = z
  .object({
    name: required("ชื่อโครงการ", 255),
    status: z.enum(["NEW", "IN_PROGRESS", "QUOTED", "WON", "CLOSED", "AFTERCARE", "ENGINEERING", "SHIPPING", "PAYMENT"]).default("NEW"),
    customerId: z.string({ error: "กรุณาเลือกลูกค้า" }).min(1, "กรุณาเลือกลูกค้า"),
    contactPerson: text(200),
    salesRepId: text(50),
    businessTypeId: text(50),
    workStageId: text(50),
    workNatureId: text(50),
    workDetail: text(2000),
    probability: z
      .union([z.number(), z.string()])
      .optional()
      .nullable()
      .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
      .refine((n) => n === null || (Number.isInteger(n) && n >= 10 && n <= 100 && n % 10 === 0), "% โอกาสสำเร็จต้องเป็น 10–100"),
    expectedCloseDate: optionalDate,
    value: money2,
    tagIds: z.array(z.string()).max(50).default([]).transform((xs) => [...new Set(xs)]),
    warrantyStart: optionalDate,
    warrantyEnd: optionalDate,
    warrantyNote: text(1000),
    note: text(2000),
  })
  .refine((d) => !d.warrantyStart || !d.warrantyEnd || d.warrantyEnd >= d.warrantyStart, {
    message: "วันสิ้นสุดการรับประกันต้องไม่ก่อนวันเริ่ม",
    path: ["warrantyEnd"],
  });
export type ProjectInput = z.input<typeof projectSchema>;
export type ProjectData = z.output<typeof projectSchema>;

const localDateTime = (label: string) =>
  z
    .string({ error: `กรุณาระบุ${label}` })
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `กรุณาระบุ${label}`)
    .refine((s) => bangkokLocalToDate(s) !== null, `${label}ไม่ถูกต้อง`);

export const workPlanSchema = z
  .object({
    subject: required("เรื่อง", 255),
    plannedStart: localDateTime("วันเวลาเริ่ม"),
    plannedEnd: localDateTime("วันเวลาสิ้นสุด"),
    employeeId: z.string({ error: "กรุณาเลือกพนักงาน" }).min(1, "กรุณาเลือกพนักงาน"),
    customerId: text(50),
    projectId: text(50),
    location: text(500),
    detail: text(2000),
  })
  .refine((d) => d.plannedEnd >= d.plannedStart, { message: "วันเวลาสิ้นสุดต้องไม่ก่อนวันเวลาเริ่ม", path: ["plannedEnd"] });
export type WorkPlanInput = z.input<typeof workPlanSchema>;
export type WorkPlanData = z.output<typeof workPlanSchema>;

export const planActionSchema = z
  .object({
    action: z.enum(["checkin_start", "checkin_end", "complete", "cancel"]),
    lat: z.number().min(-90).max(90).optional().nullable(),
    lng: z.number().min(-180).max(180).optional().nullable(),
    accuracy: z.number().min(0).max(100_000).optional().nullable(),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .refine((d) => !d.action.startsWith("checkin") || (typeof d.lat === "number" && typeof d.lng === "number"), {
    message: "ไม่พบพิกัด กรุณาอนุญาตการเข้าถึงตำแหน่ง",
    path: ["lat"],
  });
