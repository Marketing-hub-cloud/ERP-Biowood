"use client";

import { ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { ProductRow } from "@/app/api/products/route";

type Opt = { value: string; label: string };

const columns: DataColumn<ProductRow>[] = [
  {
    id: "image",
    header: "รูป",
    cell: (r) =>
      r.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.imageUrl} alt="" className="size-10 rounded object-cover" loading="lazy" />
      ) : (
        <span className="flex size-10 items-center justify-center rounded bg-muted text-muted-foreground">
          <ImageOff className="size-4" />
        </span>
      ),
  },
  { id: "code", header: "รหัส", sortable: true, cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
  {
    id: "name",
    header: "ชื่อ",
    sortable: true,
    cell: (r) => (
      <span className="font-medium">
        {r.name} {!r.isActive && <Badge variant="secondary">ปิดใช้งาน</Badge>}
      </span>
    ),
  },
  { id: "productType", header: "ประเภทสินค้า", cell: (r) => r.productType ?? "-" },
  { id: "category", header: "หมวดหมู่", cell: (r) => <span className="text-sm">{r.category ?? "-"}</span> },
  { id: "unit", header: "หน่วย", cell: (r) => r.unit ?? "-" },
  { id: "isStockable", header: "สต๊อกได้", cell: (r) => (r.isStockable ? "ใช่" : <span className="text-muted-foreground">ไม่ใช่</span>) },
  { id: "onHand", header: "คงเหลือ", cell: (r) => (r.isStockable ? formatNumber(r.onHand) : "-"), className: "text-right" },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function ProductsTable({ types, categories }: { types: Opt[]; categories: Opt[] }) {
  return (
    <DataTable<ProductRow>
      endpoint="/api/products"
      storageKey="products"
      columns={columns}
      searchPlaceholder="ค้นหารหัส ชื่อ รายละเอียด..."
      rowHref={(r) => `/inventory/products/${r.id}`}
      filters={[
        { id: "type", label: "ประเภทสินค้า", options: types },
        { id: "category", label: "หมวดหมู่ (รวมหมวดย่อย)", options: categories },
        {
          id: "stockable",
          label: "สต๊อกได้",
          options: [
            { value: "yes", label: "ใช่" },
            { value: "no", label: "ไม่ใช่" },
          ],
        },
        {
          id: "status",
          label: "สถานะ",
          options: [
            { value: "active", label: "ใช้งาน" },
            { value: "inactive", label: "ปิดใช้งาน" },
          ],
        },
      ]}
    />
  );
}
