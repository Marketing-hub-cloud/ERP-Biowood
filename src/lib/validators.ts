// Zod schemas — ใช้ร่วมกันทั้งฝั่ง client และ server
import { z } from "zod";
import { PERMISSION_MENU_KEYS } from "./menu";

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
  kind: z.enum(["CONTACT_SOURCE", "CUSTOMER_BUSINESS_TYPE"]),
  label: required("ชื่อตัวเลือก", 100),
});

export const tagSchema = z.object({ name: required("ชื่อกลุ่ม", 50) });
