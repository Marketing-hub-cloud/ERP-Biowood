"use client";

import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/approval";
import type { RequestRow } from "@/app/api/purchase/requests/route";
import { PurchaseStatusBadge } from "../_components/purchase-ui";

const columns: DataColumn<RequestRow>[] = [
  { id: "docNo", header: "เลขที่เอกสาร", sortable: true, cell: (r) => <span className="font-mono text-xs font-medium">{r.docNo}</span> },
  { id: "docDate", header: "วันที่", sortable: true, cell: (r) => formatDate(r.docDate) },
  { id: "requiredDate", header: "ต้องการภายใน", sortable: true, cell: (r) => formatDate(r.requiredDate) || "-" },
  { id: "requester", header: "ผู้ขอ", cell: (r) => r.requester },
  { id: "department", header: "แผนก", cell: (r) => r.department ?? "-" },
  { id: "products", header: "สินค้า", cell: (r) => <span className="line-clamp-1 max-w-64 font-mono text-xs">{r.products || "-"}</span> },
  { id: "lineCount", header: "รายการ", className: "text-right", defaultHidden: true, cell: (r) => formatNumber(r.lineCount) },
  { id: "status", header: "สถานะ", cell: (r) => <PurchaseStatusBadge docType="PR" status={r.status} /> },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function RequestsTable() {
  return (
    <DataTable<RequestRow>
      endpoint="/api/purchase/requests"
      storageKey="purchase-requests"
      columns={columns}
      searchPlaceholder="ค้นหาเลขที่ ผู้ขอ แผนก สินค้า..."
      rowHref={(r) => `/purchase/requests/${r.id}`}
      filters={[
        { id: "date", label: "วันที่เอกสาร", type: "dateRange" },
        { id: "status", label: "สถานะ", options: Object.entries(STATUS_LABELS.PR).map(([value, label]) => ({ value, label })) },
      ]}
    />
  );
}
