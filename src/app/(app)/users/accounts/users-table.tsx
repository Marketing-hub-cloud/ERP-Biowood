"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { formatDateTime } from "@/lib/format";
import type { UserRow } from "@/app/api/users/route";

const columns: DataColumn<UserRow>[] = [
  { id: "email", header: "อีเมล", sortable: true, cell: (r) => <span className="font-medium">{r.email}</span> },
  { id: "firstName", header: "ชื่อ-นามสกุล", sortable: true, cell: (r) => r.name },
  { id: "department", header: "แผนก", sortable: true, cell: (r) => r.department ?? "-" },
  { id: "position", header: "ตำแหน่ง", sortable: true, cell: (r) => r.position ?? "-" },
  {
    id: "groups",
    header: "กลุ่มสิทธิ์",
    cell: (r) => (
      <div className="flex flex-wrap gap-1">
        {r.isAdmin && <Badge>ผู้ดูแลระบบ</Badge>}
        {r.groups.map((g) => (
          <Badge key={g} variant="secondary">
            {g}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    id: "status",
    header: "สถานะ",
    sortable: true,
    cell: (r) =>
      r.status === "ACTIVE" ? (
        <Badge className="bg-emerald-100 text-emerald-800">ใช้งาน</Badge>
      ) : (
        <Badge variant="destructive" title={r.statusNote ?? undefined}>
          หยุดใช้งาน
        </Badge>
      ),
  },
  { id: "lastLoginAt", header: "เข้าสู่ระบบล่าสุด", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.lastLoginAt) || "-" },
  { id: "createdAt", header: "วันที่สร้าง", sortable: true, defaultHidden: true, cell: (r) => formatDateTime(r.createdAt) },
];

export function UsersTable({ groups, departments }: { groups: { id: string; name: string }[]; departments: string[] }) {
  return (
    <DataTable<UserRow>
      endpoint="/api/users"
      storageKey="users"
      columns={columns}
      searchPlaceholder="ค้นหาอีเมล ชื่อ แผนก..."
      rowHref={(r) => `/users/accounts/${r.id}`}
      filters={[
        {
          id: "status",
          label: "สถานะ",
          options: [
            { value: "ACTIVE", label: "ใช้งาน" },
            { value: "INACTIVE", label: "หยุดใช้งาน" },
          ],
        },
        { id: "group", label: "กลุ่มสิทธิ์", options: groups.map((g) => ({ value: g.id, label: g.name })) },
        { id: "department", label: "แผนก", options: departments.map((d) => ({ value: d, label: d })) },
      ]}
    />
  );
}
