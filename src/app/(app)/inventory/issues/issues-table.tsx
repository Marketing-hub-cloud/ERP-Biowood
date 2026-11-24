"use client";

import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { ISSUE_STATUS_LABELS, ISSUE_TYPE_LABELS } from "@/lib/stock-rules";
import type { IssueRow } from "@/app/api/inventory/issues/route";
import { DocStatusBadge } from "../_components/doc-status-badge";

const columns: DataColumn<IssueRow>[] = [
  { id: "docNo", header: "เลขที่เอกสาร", sortable: true, cell: (r) => <span className="font-mono text-xs font-medium">{r.docNo}</span> },
  { id: "docDate", header: "วันที่", sortable: true, cell: (r) => formatDate(r.docDate) },
  { id: "type", header: "ประเภท", cell: (r) => ISSUE_TYPE_LABELS[r.type] },
  { id: "recipient", header: "ลูกค้า/ผู้รับ", cell: (r) => r.recipient || "-" },
  { id: "products", header: "สินค้า", cell: (r) => <span className="line-clamp-1 max-w-64 font-mono text-xs">{r.products || "-"}</span> },
  { id: "lineCount", header: "จำนวน SN", className: "text-right", cell: (r) => formatNumber(r.lineCount) },
  { id: "totalQty", header: "จำนวนรวม", className: "text-right", defaultHidden: true, cell: (r) => formatNumber(r.totalQty) },
  { id: "status", header: "สถานะ", cell: (r) => <DocStatusBadge kind="issue" status={r.status} /> },
  { id: "createdBy", header: "ผู้สร้าง", defaultHidden: true, cell: (r) => r.createdBy },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function IssuesTable() {
  return (
    <DataTable<IssueRow>
      endpoint="/api/inventory/issues"
      storageKey="goods-issues"
      columns={columns}
      searchPlaceholder="ค้นหาเลขที่ ลูกค้า สินค้า barcode..."
      rowHref={(r) => `/inventory/issues/${r.id}`}
      filters={[
        { id: "date", label: "วันที่เอกสาร", type: "dateRange" },
        { id: "type", label: "ประเภท", options: Object.entries(ISSUE_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
        { id: "status", label: "สถานะ", options: Object.entries(ISSUE_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
      ]}
    />
  );
}
