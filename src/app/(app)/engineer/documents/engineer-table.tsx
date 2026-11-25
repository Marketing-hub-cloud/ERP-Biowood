"use client";

import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDate, formatDateTime } from "@/lib/format";
import { ENGINEER_STATUS_LABELS, URGENCY_LABELS, WORK_TYPE_LABELS } from "@/lib/engineer-workflow";
import type { EngineerRow } from "@/app/api/engineer/documents/route";
import { EngineerStatusBadge, UrgentBadge } from "./engineer-ui";

const columns: DataColumn<EngineerRow>[] = [
  {
    id: "docNo",
    header: "เลขที่เอกสาร",
    sortable: true,
    cell: (r) => (
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-xs font-medium">{r.docNo}</span>
        {r.urgency === "URGENT" && <UrgentBadge />}
      </span>
    ),
  },
  { id: "docDate", header: "วันที่ออกเอกสาร", sortable: true, cell: (r) => formatDate(r.docDate) },
  { id: "projectName", header: "ชื่อโครงการ", sortable: true, cell: (r) => <span className="line-clamp-1 max-w-64">{r.projectName}</span> },
  { id: "customer", header: "ลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-56">{r.customer ?? "-"}</span> },
  { id: "workTypes", header: "ประเภทงาน", cell: (r) => r.workTypes.map((w) => WORK_TYPE_LABELS[w]).join(", ") },
  { id: "urgency", header: "ความเร่งด่วน", defaultHidden: true, cell: (r) => URGENCY_LABELS[r.urgency] },
  { id: "assignee", header: "ผู้รับผิดชอบ", cell: (r) => r.assignee ?? "-" },
  { id: "dueDate", header: "กำหนดส่ง", sortable: true, cell: (r) => formatDate(r.dueDate) || "-" },
  { id: "revision", header: "ครั้งที่", className: "text-right", defaultHidden: true, cell: (r) => r.revision },
  { id: "status", header: "สถานะ", cell: (r) => <EngineerStatusBadge status={r.status} /> },
  { id: "createdBy", header: "ผู้สร้าง", defaultHidden: true, cell: (r) => r.createdBy },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function EngineerTable() {
  return (
    <DataTable<EngineerRow>
      endpoint="/api/engineer/documents"
      storageKey="engineer-documents"
      columns={columns}
      searchPlaceholder="ค้นหาเลขที่ ชื่อโครงการ ลูกค้า ผู้รับผิดชอบ..."
      rowHref={(r) => `/engineer/documents/${r.id}`}
      filters={[
        { id: "date", label: "วันที่ออกเอกสาร", type: "dateRange" },
        {
          id: "status",
          label: "สถานะ",
          options: [{ value: "open", label: "ยังไม่เสร็จ" }, ...Object.entries(ENGINEER_STATUS_LABELS).map(([value, label]) => ({ value, label }))],
        },
        { id: "urgency", label: "ความเร่งด่วน", options: Object.entries(URGENCY_LABELS).map(([value, label]) => ({ value, label })) },
        { id: "workType", label: "ประเภทงาน", options: Object.entries(WORK_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
        { id: "mine", label: "งานของฉัน", options: [{ value: "1", label: "เกี่ยวข้องกับฉัน" }] },
      ]}
    />
  );
}
