"use client";

import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { RECEIPT_STATUS_LABELS, RECEIPT_TYPE_LABELS } from "@/lib/stock-rules";
import type { ReceiptRow } from "@/app/api/inventory/receipts/route";
import { DocStatusBadge } from "../_components/doc-status-badge";

type Opt = { value: string; label: string };

const columns: DataColumn<ReceiptRow>[] = [
  { id: "docNo", header: "เลขที่เอกสาร", sortable: true, cell: (r) => <span className="font-mono text-xs font-medium">{r.docNo}</span> },
  { id: "docDate", header: "วันที่", sortable: true, cell: (r) => formatDate(r.docDate) },
  { id: "type", header: "ประเภท", cell: (r) => RECEIPT_TYPE_LABELS[r.type] },
  { id: "warehouse", header: "คลัง", cell: (r) => r.warehouse },
  { id: "lot", header: "Lot", cell: (r) => r.lot ?? "-" },
  { id: "products", header: "สินค้า", cell: (r) => <span className="line-clamp-1 max-w-64 font-mono text-xs">{r.products || "-"}</span> },
  { id: "serialCount", header: "จำนวน SN", className: "text-right", cell: (r) => formatNumber(r.serialCount) },
  { id: "status", header: "สถานะ", cell: (r) => <DocStatusBadge kind="receipt" status={r.status} /> },
  { id: "createdBy", header: "ผู้สร้าง", defaultHidden: true, cell: (r) => r.createdBy },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function ReceiptsTable({ warehouses }: { warehouses: Opt[] }) {
  return (
    <DataTable<ReceiptRow>
      endpoint="/api/inventory/receipts"
      storageKey="goods-receipts"
      columns={columns}
      searchPlaceholder="ค้นหาเลขที่ Lot สินค้า barcode..."
      rowHref={(r) => `/inventory/receipts/${r.id}`}
      filters={[
        { id: "date", label: "วันที่เอกสาร", type: "dateRange" },
        { id: "type", label: "ประเภท", options: Object.entries(RECEIPT_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
        { id: "status", label: "สถานะ", options: Object.entries(RECEIPT_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
        { id: "warehouse", label: "คลัง", options: warehouses },
      ]}
    />
  );
}
