"use client";

import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/purchase-calc";
import { STATUS_LABELS } from "@/lib/approval";
import type { OrderRow } from "@/app/api/purchase/orders/route";
import { PurchaseStatusBadge } from "../_components/purchase-ui";

const columns: DataColumn<OrderRow>[] = [
  { id: "docNo", header: "เลขที่เอกสาร", sortable: true, cell: (r) => <span className="font-mono text-xs font-medium">{r.docNo}</span> },
  { id: "docDate", header: "วันที่", sortable: true, cell: (r) => formatDate(r.docDate) },
  { id: "vendor", header: "ผู้ขาย", cell: (r) => r.vendor },
  { id: "deliveryDate", header: "วันที่ส่งของ", sortable: true, cell: (r) => formatDate(r.deliveryDate) || "-" },
  { id: "products", header: "สินค้า", cell: (r) => <span className="line-clamp-1 max-w-56 font-mono text-xs">{r.products || "-"}</span> },
  { id: "total", header: "ยอดรวม", sortable: true, className: "text-right tabular-nums", cell: (r) => formatMoney(r.total) },
  { id: "status", header: "สถานะ", cell: (r) => <PurchaseStatusBadge docType="PO" status={r.status} /> },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function OrdersTable() {
  return (
    <DataTable<OrderRow>
      endpoint="/api/purchase/orders"
      storageKey="purchase-orders"
      columns={columns}
      searchPlaceholder="ค้นหาเลขที่ ผู้ขาย สินค้า เลข PR..."
      rowHref={(r) => `/purchase/orders/${r.id}`}
      filters={[
        { id: "date", label: "วันที่เอกสาร", type: "dateRange" },
        { id: "status", label: "สถานะ", options: Object.entries(STATUS_LABELS.PO).map(([value, label]) => ({ value, label })) },
      ]}
    />
  );
}
