"use client";

import { Mail, MessageCircle, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDateTime, formatNumber } from "@/lib/format";
import { CHANNEL_LABELS } from "@/lib/validators";
import type { ContactRow } from "@/app/api/contacts/route";

type Opt = { value: string; label: string };

function ChannelCell({ c }: { c: ContactRow["primaryChannel"] }) {
  if (!c) return <span className="text-muted-foreground">-</span>;
  const Icon = c.type === "EMAIL" ? Mail : c.type === "LINE" || c.type === "FACEBOOK" ? MessageCircle : Phone;
  return (
    <span className="inline-flex items-center gap-1.5" title={CHANNEL_LABELS[c.type]}>
      <Icon className="size-3.5 text-muted-foreground" /> {c.value}
    </span>
  );
}

export function RoleBadges({ isCustomer, isVendor }: { isCustomer: boolean; isVendor: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {isCustomer && <Badge className="bg-emerald-100 text-emerald-800">ลูกค้า</Badge>}
      {isVendor && <Badge className="bg-sky-100 text-sky-800">ผู้ขาย</Badge>}
    </div>
  );
}

const columns: DataColumn<ContactRow>[] = [
  { id: "type", header: "ประเภท", cell: (r) => <RoleBadges isCustomer={r.isCustomer} isVendor={r.isVendor} /> },
  { id: "code", header: "รหัส", sortable: true, cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
  {
    id: "name",
    header: "ชื่อ",
    sortable: true,
    cell: (r) => (
      <div>
        <div className="font-medium">{r.name}</div>
        {r.primaryPerson && <div className="text-xs text-muted-foreground">ติดต่อ: {r.primaryPerson}</div>}
      </div>
    ),
  },
  { id: "entityType", header: "ประเภทกิจการ", sortable: true, cell: (r) => (r.entityType === "JURISTIC" ? "นิติบุคคล" : "บุคคลธรรมดา") },
  { id: "channel", header: "ช่องทางติดต่อ", cell: (r) => <ChannelCell c={r.primaryChannel} /> },
  { id: "projectCount", header: "จำนวนโครงการ", cell: (r) => formatNumber(r.projectCount), className: "text-right" },
  { id: "customerBusinessType", header: "ประเภทกิจการของลูกค้า", defaultHidden: true, cell: (r) => r.customerBusinessType ?? "-" },
  { id: "taxId", header: "เลขผู้เสียภาษี", defaultHidden: true, cell: (r) => r.taxId ?? "-" },
  { id: "province", header: "จังหวัด", defaultHidden: true, cell: (r) => r.province ?? "-" },
  { id: "source", header: "ช่องทางที่รู้จัก", defaultHidden: true, cell: (r) => r.source ?? "-" },
  {
    id: "tags",
    header: "กลุ่ม",
    defaultHidden: true,
    cell: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.tags.map((t) => (
          <Badge key={t} variant="outline">
            {t}
          </Badge>
        ))}
      </div>
    ),
  },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function ContactsTable({
  tab,
  sources,
  businessTypes,
  tags,
  provinces,
}: {
  tab: "all" | "customer" | "vendor";
  sources: Opt[];
  businessTypes: Opt[];
  tags: Opt[];
  provinces: Opt[];
}) {
  return (
    <DataTable<ContactRow>
      endpoint="/api/contacts"
      fixedParams={tab === "all" ? undefined : { f_role: tab }}
      storageKey="contacts"
      columns={columns}
      searchPlaceholder="ค้นหาชื่อ รหัส เบอร์โทร อีเมล..."
      rowHref={(r) => `/contacts/${r.id}`}
      filters={[
        {
          id: "entityType",
          label: "ประเภทกิจการ",
          options: [
            { value: "JURISTIC", label: "นิติบุคคล" },
            { value: "INDIVIDUAL", label: "บุคคลธรรมดา" },
          ],
        },
        { id: "businessType", label: "ประเภทกิจการของลูกค้า", options: businessTypes },
        { id: "source", label: "ช่องทางที่รู้จัก", options: sources },
        { id: "tag", label: "กลุ่ม", options: tags },
        { id: "province", label: "จังหวัด", options: provinces },
      ]}
    />
  );
}
