"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { ScheduleCalendar, viewDays, type CalendarView } from "@/components/calendar/schedule-calendar";
import type { CalendarEvent } from "@/components/calendar/month-calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { DELIVERY_STATUS_LABELS } from "@/lib/delivery";
import type { DeliveryRow } from "@/app/api/inventory/deliveries/route";
import { DELIVERY_CLASS, DeliveryStatusBadge } from "./delivery-ui";

const columns: DataColumn<DeliveryRow>[] = [
  { id: "startAt", header: "วันเวลาเริ่ม", sortable: true, cell: (r) => <span className="tabular-nums">{formatDateTime(r.startAt)}</span> },
  { id: "endAt", header: "วันเวลาสิ้นสุด", cell: (r) => <span className="tabular-nums">{formatDateTime(r.endAt)}</span> },
  { id: "status", header: "สถานะ", cell: (r) => <DeliveryStatusBadge status={r.status} /> },
  { id: "driver", header: "พนักงานจัดส่ง", cell: (r) => r.driver },
  { id: "issueNo", header: "ใบนำออก", cell: (r) => <span className="font-medium">{r.issueNo}</span> },
  { id: "customer", header: "ลูกค้า/ผู้รับ", cell: (r) => <span className="line-clamp-1 max-w-56">{r.customer ?? "-"}</span> },
  { id: "shippingAddress", header: "ที่อยู่จัดส่ง", cell: (r) => <span className="line-clamp-1 max-w-72">{r.shippingAddress ?? "-"}</span> },
  {
    id: "map",
    header: "แผนที่",
    cell: (r) =>
      r.mapHref ? (
        <a href={r.mapHref} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-primary hover:underline">
          เปิด <ExternalLink className="size-3" />
        </a>
      ) : (
        "-"
      ),
  },
];

type Opt = { value: string; label: string };
const ALL = "__all__";

function CalendarTab({ drivers, today }: { drivers: Opt[]; today: string }) {
  const [state, setState] = useState<{ view: CalendarView; anchor: string }>({ view: "month", anchor: today });
  const [driver, setDriver] = useState(ALL);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const days = viewDays(state.view, state.anchor);
  const sp = new URLSearchParams({ pageSize: "200", sort: "startAt:asc", f_from: days[0], f_to: days[days.length - 1] });
  if (driver !== ALL) sp.set("f_driver", driver);
  const query = sp.toString();
  const loading = loadedQuery !== query;

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/inventory/deliveries?${query}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: DeliveryRow[] }) =>
        setEvents(
          d.rows.map((r) => ({
            id: r.id,
            title: `${r.issueNo}${r.customer ? ` · ${r.customer}` : ""}${driver === ALL ? ` · ${r.driver}` : ""}`,
            subtitle: [r.shippingAddress, `สถานะ: ${DELIVERY_STATUS_LABELS[r.status]}`].filter(Boolean).join(" · "),
            start: r.startAt,
            end: r.endAt,
            href: `/inventory/deliveries/${r.id}`,
            className: DELIVERY_CLASS[r.status],
            muted: r.status === "CANCELLED",
          })),
        ),
      )
      .catch(() => undefined)
      .finally(() => !ctrl.signal.aborted && setLoadedQuery(query));
    return () => ctrl.abort();
  }, [query, driver]);

  return (
    <div className="space-y-3">
      <Select value={driver} onValueChange={setDriver}>
        <SelectTrigger className="w-56" aria-label="กรองพนักงานจัดส่ง">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>พนักงานทั้งหมด</SelectItem>
          {drivers.map((e) => (
            <SelectItem key={e.value} value={e.value}>
              {e.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ScheduleCalendar view={state.view} anchor={state.anchor} onChange={(view, anchor) => setState({ view, anchor })} events={events} today={today} loading={loading} />
    </div>
  );
}

export function DeliveriesView({ drivers, today }: { drivers: Opt[]; today: string }) {
  return (
    <Tabs defaultValue="calendar">
      <TabsList>
        <TabsTrigger value="calendar">ปฏิทิน</TabsTrigger>
        <TabsTrigger value="list">รายการ</TabsTrigger>
      </TabsList>
      <TabsContent value="calendar" className="mt-4">
        <CalendarTab drivers={drivers} today={today} />
      </TabsContent>
      <TabsContent value="list" className="mt-4">
        <DataTable<DeliveryRow>
          endpoint="/api/inventory/deliveries"
          storageKey="inventory-deliveries"
          columns={columns}
          searchPlaceholder="ค้นหาใบนำออก ลูกค้า ที่อยู่ พนักงาน..."
          rowHref={(r) => `/inventory/deliveries/${r.id}`}
          filters={[
            { id: "driver", label: "พนักงานจัดส่ง", options: drivers },
            { id: "status", label: "สถานะ", options: Object.entries(DELIVERY_STATUS_LABELS).map(([value, label]) => ({ value, label })) },
            { id: "date", label: "วันที่จัดส่ง", type: "dateRange" },
          ]}
        />
      </TabsContent>
    </Tabs>
  );
}
