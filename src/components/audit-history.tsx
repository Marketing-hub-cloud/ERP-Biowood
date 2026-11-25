"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import type { AuditEntry } from "@/app/api/audit/route";

const ACTION_LABEL: Record<string, string> = {
  CREATE: "สร้าง",
  UPDATE: "แก้ไข",
  DELETE: "ลบ",
  STATUS_CHANGE: "เปลี่ยนสถานะ",
  APPROVE: "อนุมัติ",
  REJECT: "ไม่อนุมัติ",
  CANCEL: "ยกเลิก",
};

/** ชื่อฟิลด์ภาษาไทย (เพิ่มได้เรื่อยๆ ตามโมดูล) */
const FIELD_LABEL: Record<string, string> = {
  email: "อีเมล",
  firstName: "ชื่อ",
  lastName: "นามสกุล",
  department: "แผนก",
  position: "ตำแหน่ง",
  isAdmin: "ผู้ดูแลระบบ",
  status: "สถานะ",
  statusNote: "หมายเหตุสถานะ",
  groups: "กลุ่มสิทธิ์",
  name: "ชื่อ",
  description: "คำอธิบาย",
  permissions: "สิทธิ์",
  members: "สมาชิก",
  nameTh: "ชื่อบริษัท (ไทย)",
  nameEn: "ชื่อบริษัท (อังกฤษ)",
  address: "ที่อยู่",
  taxId: "เลขประจำตัวผู้เสียภาษี",
  branch: "สาขา",
  phone: "เบอร์โทร",
  website: "เว็บไซต์",
  logoKey: "โลโก้",
  code: "รหัส",
  roles: "ประเภทผู้ติดต่อ",
  entityType: "ประเภทกิจการ",
  source: "ช่องทางที่รู้จัก",
  customerBusinessType: "ประเภทกิจการของลูกค้า",
  note: "หมายเหตุ",
  photoKey: "รูป",
  regAddressText: "ที่อยู่จดทะเบียน",
  shippingAddresses: "ที่อยู่จัดส่ง",
  channels: "ช่องทางติดต่อ",
  persons: "บุคคลติดต่อ",
  tags: "กลุ่ม",
  parent: "อยู่ภายใต้",
  level: "ระดับ",
  sortOrder: "ลำดับ",
  isActive: "เปิดใช้งาน",
  dataType: "ชนิดข้อมูล",
  options: "ตัวเลือก",
  unitLabel: "หน่วยกำกับ",
  isRequired: "บังคับกรอก",
  productType: "ประเภทสินค้า",
  category: "หมวดหมู่",
  isStockable: "สต๊อกได้",
  stockUnit: "หน่วยสต๊อก",
  attributes: "ข้อมูลเฉพาะ",
  images: "จำนวนรูป",
  type: "ประเภท",
  docDate: "วันที่เอกสาร",
  warehouse: "คลัง",
  lot: "Lot",
  lines: "รายการ",
  contact: "ลูกค้า/ผู้ติดต่อ",
  recipientName: "ชื่อผู้รับ",
  shippingAddress: "ที่อยู่จัดส่ง",
  // ใบถอดแบบ/ติดตั้ง
  startDate: "วันที่เริ่มงาน",
  dueDate: "วันที่กำหนดส่ง",
  revision: "ครั้งที่",
  workTypes: "ประเภทงาน",
  workDetail: "ข้อมูลลักษณะงาน",
  projectName: "ชื่อโครงการ",
  urgency: "ความเร่งด่วน",
  customer: "ลูกค้า",
  siteAddress: "ที่อยู่",
  assignee: "ผู้รับผิดชอบงาน",
  participants: "ผู้เกี่ยวข้อง",
  estimateLines: "ใบสรุปประมาณถอดแบบ",
  files: "ไฟล์แนบ",
};

const VALUE_LABEL: Record<string, string> = { ACTIVE: "ใช้งาน", INACTIVE: "หยุดใช้งาน", true: "ใช่", false: "ไม่ใช่" };
const HIDDEN_FIELDS = new Set(["id"]);

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "-";
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${String(x)}`)
      .join("; ") || "-";
  }
  return VALUE_LABEL[String(v)] ?? String(v);
}

export function AuditHistory({ entityType, entityId, title = "ประวัติการเปลี่ยนแปลง" }: { entityType: string; entityId: string; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" onClick={() => setOpen(true)} aria-label={title}>
            <History />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>ใคร ทำอะไร เมื่อไร</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-6">{open && <AuditList entityType={entityType} entityId={entityId} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AuditList({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [logs, setLogs] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setLogs(d);
      })
      .catch((e) => setError(e.message));
  }, [entityType, entityId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!logs) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;
  if (!logs.length) return <p className="text-sm text-muted-foreground">ยังไม่มีประวัติ</p>;

  return (
    <ol className="relative space-y-4 border-l pl-4" data-testid="audit-list">
      {logs.map((l) => {
        const changes = Object.entries(l.changes ?? {}).filter(([k]) => !HIDDEN_FIELDS.has(k));
        return (
          <li key={l.id} className="relative">
            <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{ACTION_LABEL[l.action] ?? l.action}</Badge>
              <span className="font-medium">{l.actorName ?? "ระบบ"}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(l.createdAt)}</span>
            </div>
            {l.note && <p className="mt-1 text-sm">{l.note}</p>}
            {l.action !== "CREATE" && changes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 rounded-md bg-muted/60 p-2 text-xs">
                {changes.map(([k, [o, n]]) => (
                  <li key={k}>
                    <span className="font-medium">{FIELD_LABEL[k] ?? k}</span>: <span className="text-muted-foreground line-through">{show(o)}</span> →{" "}
                    <span>{show(n)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
