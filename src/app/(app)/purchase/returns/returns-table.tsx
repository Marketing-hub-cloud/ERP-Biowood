"use client";

import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDate, formatDateTime } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/approval";
import type { ReturnRow } from "@/app/api/purchase/returns/route";
import { PurchaseStatusBadge } from "../_components/purchase-ui";

const columns: DataColumn<ReturnRow>[] = [
  { id: "docNo", header: "เลขที่เอกสาร", sortable: true, cell: (r) => <span className="font-mono text-xs font-medium">{r.docNo}</span> },
  { id: "docDate", header: "วันที่", sortable: true, cell: (r) => formatDate(r.docDate) },
  { id: "orderDocNo", header: "ใบสั่งซื้อ", cell: (r) => <span className="font-mono text-xs">{r.orderDocNo}</span> },
  { id: "vendor", header: "ผู้ขาย", cell: (r) => r.vendor },
  { id: "reason", header: "เหตุผล", cell: (r) => r.reason },
  { id: "products", header: "สินค้า", cell: (r) => <span className="line-clamp-1 max-w-56 font-mono text-xs">{r.products || "-"}</span> },
  { id: "status", header: "สถานะ", cell: (r) => <PurchaseStatusBadge docType="RT" status={r.status} /> },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function ReturnsTable() {
  return (
    <DataTable<ReturnRow>
      endpoint="/api/purchase/returns"
      storageKey="purchase-returns"
      columns={columns}
      searchPlaceholder="ค้นหาเลขที่ ใบสั่งซื้อ ผู้ขาย สินค้า..."
      rowHref={(r) => `/purchase/returns/${r.id}`}
      filters={[
        { id: "date", label: "วันที่เอกสาร", type: "dateRange" },
        { id: "status", label: "สถานะ", options: Object.entries(STATUS_LABELS.RT).map(([value, label]) => ({ value, label })) },
      ]}
    />
  );
}
