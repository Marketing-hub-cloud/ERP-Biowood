"use client";

import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { GroupRow } from "@/app/api/permission-groups/route";

const columns: DataColumn<GroupRow>[] = [
  { id: "name", header: "ชื่อกลุ่มสิทธิ์", sortable: true, cell: (r) => <span className="font-medium">{r.name}</span> },
  { id: "description", header: "คำอธิบาย", cell: (r) => r.description ?? "-" },
  { id: "memberCount", header: "จำนวนสมาชิก", cell: (r) => formatNumber(r.memberCount), className: "text-right" },
  { id: "menuCount", header: "เมนูที่เข้าถึงได้", cell: (r) => formatNumber(r.menuCount), className: "text-right" },
  { id: "updatedAt", header: "แก้ไขล่าสุด", sortable: true, cell: (r) => formatDateTime(r.updatedAt) },
];

export function GroupsTable() {
  return (
    <DataTable<GroupRow>
      endpoint="/api/permission-groups"
      storageKey="groups"
      columns={columns}
      searchPlaceholder="ค้นหาชื่อกลุ่ม..."
      rowHref={(r) => `/users/groups/${r.id}`}
    />
  );
}
