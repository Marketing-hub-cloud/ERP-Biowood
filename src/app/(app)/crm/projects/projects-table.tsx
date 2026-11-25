"use client";

import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { PROJECT_STATUS_LABELS } from "@/lib/crm";
import type { ProjectRow } from "@/app/api/crm/projects/route";
import { ProjectStatusBadge } from "../_components/crm-ui";

const columns: DataColumn<ProjectRow>[] = [
  { id: "name", header: "ชื่อโครงการ", sortable: true, cell: (r) => <span className="line-clamp-1 max-w-72 font-medium">{r.name}</span> },
  { id: "customer", header: "ลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-56">{r.customer}</span> },
  { id: "status", header: "สถานะ", cell: (r) => <ProjectStatusBadge status={r.status} /> },
  { id: "salesRep", header: "พนักงานขาย", cell: (r) => r.salesRep ?? "-" },
  { id: "businessType", header: "ประเภทกิจการ", defaultHidden: true, cell: (r) => r.businessType ?? "-" },
  { id: "probability", header: "% โอกาส", sortable: true, className: "text-right", cell: (r) => (r.probability === null ? "-" : `${r.probability}%`) },
  { id: "value", header: "มูลค่า", sortable: true, className: "text-right", cell: (r) => (r.value === null ? "-" : formatNumber(r.value)) },
  { id: "expectedCloseDate", header: "คาดการณ์ปิดดีล", sortable: true, cell: (r) => formatDate(r.expectedCloseDate) || "-" },
  {
    id: "tags",
    header: "กลุ่ม",
    defaultHidden: true,
    cell: (r) => (
      <span className="flex flex-wrap gap-1">
        {r.tags.map((t) => (
          <Badge key={t} variant="secondary">
            {t}
          </Badge>
        ))}
      </span>
    ),
  },
  { id: "updatedAt", header: "แก้ไขล่าสุด", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.updatedAt) },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

type Opt = { value: string; label: string };

export function ProjectsTable({ salesReps, tags }: { salesReps: Opt[]; tags: Opt[] }) {
  return (
    <DataTable<ProjectRow>
      endpoint="/api/crm/projects"
      storageKey="crm-projects"
      columns={columns}
      searchPlaceholder="ค้นหาชื่อโครงการ ลูกค้า บุคคลติดต่อ พนักงานขาย..."
      rowHref={(r) => `/crm/projects/${r.id}`}
      filters={[
        { id: "status", label: "สถานะ", options: Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
        { id: "salesRep", label: "พนักงานขาย", options: salesReps },
        { id: "tag", label: "กลุ่ม", options: tags },
      ]}
    />
  );
}
