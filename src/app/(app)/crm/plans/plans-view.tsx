"use client";

import { useEffect, useState } from "react";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { MonthCalendar, monthGrid, type CalendarEvent } from "@/components/calendar/month-calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime, formatNumber } from "@/lib/format";
import { WORK_PLAN_STATUS_LABELS } from "@/lib/crm";
import type { PlanRow } from "@/app/api/crm/plans/route";
import { PLAN_CLASS, PlanStatusBadge } from "../_components/crm-ui";

const columns: DataColumn<PlanRow>[] = [
  { id: "plannedStart", header: "วันเวลาเริ่ม", sortable: true, cell: (r) => <span className="tabular-nums">{formatDateTime(r.plannedStart)}</span> },
  { id: "subject", header: "เรื่อง", sortable: true, cell: (r) => <span className="line-clamp-1 max-w-72 font-medium">{r.subject}</span> },
  { id: "status", header: "สถานะ", cell: (r) => <PlanStatusBadge status={r.status} /> },
  { id: "employee", header: "พนักงาน", cell: (r) => r.employee },
  { id: "customer", header: "ลูกค้า", cell: (r) => <span className="line-clamp-1 max-w-56">{r.customer ?? "-"}</span> },
  { id: "project", header: "โครงการ", defaultHidden: true, cell: (r) => r.project ?? "-" },
  { id: "location", header: "สถานที่", defaultHidden: true, cell: (r) => <span className="line-clamp-1 max-w-56">{r.location ?? "-"}</span> },
  { id: "plannedEnd", header: "วันเวลาสิ้นสุด", defaultHidden: true, cell: (r) => formatDateTime(r.plannedEnd) },
  { id: "distanceKm", header: "ระยะทาง (กม.)", className: "text-right", cell: (r) => (r.distanceKm === null ? "-" : formatNumber(r.distanceKm, 2)) },
];

type Opt = { value: string; label: string };
const ALL = "__all__";

function CalendarTab({ employees, today }: { employees: Opt[]; today: string }) {
  const [ym, setYm] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { y, m: m - 1 };
  });
  const [employee, setEmployee] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // โหลดเสร็จของ query ไหนแล้ว (loading = query ปัจจุบันยังไม่ใช่อันที่โหลดเสร็จ)
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const days = monthGrid(ym.y, ym.m);
  const sp = new URLSearchParams({ pageSize: "200", sort: "plannedStart:asc", f_from: days[0], f_to: days[days.length - 1] });
  if (employee !== ALL) sp.set("f_employee", employee);
  if (status !== ALL) sp.set("f_status", status);
  const query = sp.toString();
  const loading = loadedQuery !== query;

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/crm/plans?${query}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: PlanRow[] }) =>
        setEvents(
          d.rows.map((r) => ({
            id: r.id,
            title: `${r.subject}${employee === ALL ? ` · ${r.employee}` : ""}`,
            start: r.plannedStart,
            end: r.plannedEnd,
            href: `/crm/plans/${r.id}`,
            className: PLAN_CLASS[r.status],
            muted: r.status === "CANCELLED",
          })),
        ),
      )
      .catch(() => undefined)
      .finally(() => !ctrl.signal.aborted && setLoadedQuery(query));
    return () => ctrl.abort();
  }, [query, employee]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select value={employee} onValueChange={setEmployee}>
          <SelectTrigger className="w-56" aria-label="กรองพนักงาน">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>พนักงานทั้งหมด</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.value} value={e.value}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="กรองสถานะ">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>ทุกสถานะ</SelectItem>
            {Object.entries(WORK_PLAN_STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <MonthCalendar year={ym.y} month={ym.m} onMonthChange={(y, m) => setYm({ y, m })} events={events} today={today} loading={loading} />
    </div>
  );
}

export function PlansView({ employees, today }: { employees: Opt[]; today: string }) {
  return (
    <Tabs defaultValue="list">
      <TabsList>
        <TabsTrigger value="list">รายการ</TabsTrigger>
        <TabsTrigger value="calendar">ปฏิทิน</TabsTrigger>
      </TabsList>
      <TabsContent value="list" className="mt-4">
        <DataTable<PlanRow>
          endpoint="/api/crm/plans"
          storageKey="crm-plans"
          columns={columns}
          searchPlaceholder="ค้นหาเรื่อง ลูกค้า โครงการ สถานที่ พนักงาน..."
          rowHref={(r) => `/crm/plans/${r.id}`}
          filters={[
            { id: "employee", label: "พนักงาน", options: employees },
            { id: "status", label: "สถานะ", options: Object.entries(WORK_PLAN_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
            { id: "date", label: "วันที่", type: "dateRange" },
          ]}
        />
      </TabsContent>
      <TabsContent value="calendar" className="mt-4">
        <CalendarTab employees={employees} today={today} />
      </TabsContent>
    </Tabs>
  );
}
