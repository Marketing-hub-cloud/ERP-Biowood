// Audit log: ใคร ทำอะไร เมื่อไร ค่าก่อน/หลัง
import type { AuditAction } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { DbClient, TxClient } from "./db";

/** ฟิลด์ที่ห้ามเก็บลง log */
const REDACT = new Set(["passwordHash", "password", "confirmPassword", "token", "accessToken"]);
/** ฟิลด์ที่ไม่ต้องนับเป็นการเปลี่ยนแปลง */
const IGNORE = new Set(["updatedAt", "createdAt", "lastLoginAt"]);

type Plain = Record<string, unknown>;

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object" && "toJSON" in v && typeof (v as { toJSON: unknown }).toJSON === "function") {
    return (v as { toJSON: () => unknown }).toJSON();
  }
  return v;
}

export function sanitize(obj: Plain | null | undefined): Plain | null {
  if (!obj) return null;
  const out: Plain = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.has(k)) continue;
    out[k] = normalize(v);
  }
  return out;
}

/** หาฟิลด์ที่เปลี่ยน: { field: [old, new] } */
export function diff(before: Plain | null | undefined, after: Plain | null | undefined): Record<string, [unknown, unknown]> {
  const b = sanitize(before) ?? {};
  const a = sanitize(after) ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const k of keys) {
    if (IGNORE.has(k)) continue;
    const ov = b[k] ?? null;
    const nv = a[k] ?? null;
    if (JSON.stringify(ov) !== JSON.stringify(nv)) changes[k] = [ov, nv];
  }
  return changes;
}

export type AuditInput = {
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  before?: Plain | null;
  after?: Plain | null;
  note?: string | null;
  ip?: string | null;
  /** บังคับเก็บ log แม้ไม่มีฟิลด์ไหนเปลี่ยน */
  force?: boolean;
};

function json(v: unknown): Prisma.InputJsonValue | undefined {
  return v === null || v === undefined ? undefined : (v as Prisma.InputJsonValue);
}

/** บันทึก audit log — ควรเรียกใน transaction เดียวกับการบันทึกข้อมูล */
export async function writeAudit(tx: TxClient | DbClient, input: AuditInput) {
  const changes = diff(input.before, input.after);
  if (input.action === "UPDATE" && !input.force && Object.keys(changes).length === 0) return null;
  return tx.auditLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: json(sanitize(input.before)),
      after: json(sanitize(input.after)),
      changes: json(Object.keys(changes).length ? changes : null),
      note: input.note ?? null,
      ip: input.ip ?? null,
    },
  });
}
