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
