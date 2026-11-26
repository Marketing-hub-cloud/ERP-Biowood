"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bkkDay, bkkTime, eventsByDay, MonthGrid, monthGrid, type CalendarEvent } from "./month-calendar";

export type CalendarView = "month" | "week" | "day";
export const VIEW_LABELS: Record<CalendarView, string> = { month: "เดือน", week: "สัปดาห์", day: "วัน" };

const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const MONTHS_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WEEKDAYS_LONG = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const addDays = (iso: string, n: number) => new Date(toDate(iso).getTime() + n * 86400_000).toISOString().slice(0, 10);
const weekday = (iso: string) => WEEKDAYS_LONG[toDate(iso).getUTCDay()];
const dm = (iso: string) => `${Number(iso.slice(8))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;

/** วันจันทร์ของสัปดาห์ที่มีวันนี้ */
export function weekStart(iso: string): string {
  return addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));
}

/** ช่วงวันที่ (YYYY-MM-DD) ที่มุมมองนี้แสดง — ใช้กรองข้อมูลที่โหลด */
export function viewDays(view: CalendarView, anchor: string): string[] {
  if (view === "day") return [anchor];
  if (view === "week") {
    const s = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const [y, m] = anchor.split("-").map(Number);
  return monthGrid(y, m - 1);
}

function shiftAnchor(view: CalendarView, anchor: string, n: number): string {
  if (view === "day") return addDays(anchor, n);
  if (view === "week") return addDays(anchor, 7 * n);
  const [y, m] = anchor.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

function title(view: CalendarView, anchor: string): string {
  const y = anchor.slice(0, 4);
  if (view === "month") return `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${y}`;
  if (view === "day") return `${weekday(anchor)} ${dm(anchor)} ${y}`;
  const days = viewDays("week", anchor);
  return `${dm(days[0])} – ${dm(days[6])} ${days[6].slice(0, 4)}`;
}

/** เวลาที่แสดงของ event ในวันนั้น (งานหลายวัน: วันแรกแสดงเวลาเริ่ม วันสุดท้ายแสดงเวลาสิ้นสุด) */
function timeRange(e: CalendarEvent, day: string): string {
  const s = bkkDay(e.start) === day ? bkkTime(e.start) : "…";
  const en = bkkDay(e.end) === day ? bkkTime(e.end) : "…";
  return `${s}–${en}`;
}

function EventCard({ e, day, detailed }: { e: CalendarEvent; day: string; detailed?: boolean }) {
  return (
    <Link
      href={e.href}
      title={e.title}
      className={cn("block rounded-md px-2 py-1.5 text-xs hover:opacity-80", e.className ?? "bg-primary/10 text-primary", e.muted && "opacity-60")}
    >
      <div className="tabular-nums opacity-80">{timeRange(e, day)}</div>
      <div className={cn("font-medium", !detailed && "line-clamp-2", e.muted && "line-through")}>{e.title}</div>
      {e.subtitle && <div className={cn("opacity-80", !detailed && "line-clamp-2")}>{e.subtitle}</div>}
    </Link>
  );
}

/**
 * ปฏิทินตารางงาน: มุมมอง เดือน / สัปดาห์ / วัน
 * anchor = วันที่อ้างอิง (YYYY-MM-DD); ผู้เรียกโหลด event ตามช่วง viewDays(view, anchor)
 */
export function ScheduleCalendar({
  view,
  anchor,
  onChange,
  events,
  today,
  loading,
}: {
  view: CalendarView;
  anchor: string;
  onChange: (view: CalendarView, anchor: string) => void;
  events: CalendarEvent[];
  today: string;
  loading?: boolean;
}) {
  const days = viewDays(view, anchor);
  const byDay = eventsByDay(events, days);
  const [y, m] = anchor.split("-").map(Number);

  return (
    <div className="rounded-lg border bg-card" data-testid="schedule-calendar" data-view={view}>
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button type="button" variant="outline" size="icon-sm" onClick={() => onChange(view, shiftAnchor(view, anchor, -1))} aria-label="ก่อนหน้า">
          <ChevronLeft />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => onChange(view, shiftAnchor(view, anchor, 1))} aria-label="ถัดไป">
          <ChevronRight />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(view, today)}>
          วันนี้
        </Button>
        <h2 className="font-medium" aria-live="polite" data-testid="calendar-title">
          {title(view, anchor)}
        </h2>
        {loading && <span className="text-xs text-muted-foreground">กำลังโหลด...</span>}
        <div className="ml-auto inline-flex rounded-md border p-0.5" role="group" aria-label="มุมมองปฏิทิน">
          {(Object.keys(VIEW_LABELS) as CalendarView[]).map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={v === view ? "default" : "ghost"}
              className="h-7 px-3"
              aria-pressed={v === view}
              onClick={() => onChange(v, anchor)}
            >
              {VIEW_LABELS[v]}
            </Button>
          ))}
        </div>
      </div>

      {view === "month" && <MonthGrid year={y} month={m - 1} events={events} today={today} />}

      {view === "week" && (
        <div className="grid grid-cols-1 md:grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <div key={d} className="min-h-24 border-b p-2 md:min-h-96 md:border-r md:border-b-0" data-day={d}>
                <button
                  type="button"
                  onClick={() => onChange("day", d)}
                  className={cn("mb-2 flex w-full items-center gap-2 rounded text-left text-xs hover:bg-muted md:flex-col md:items-start md:gap-0", d === today && "text-primary")}
                >
                  <span>{weekday(d)}</span>
                  <span className={cn("text-base font-medium", d === today && "rounded-full bg-primary px-2 text-primary-foreground")}>{Number(d.slice(8))}</span>
                </button>
                <ul className="space-y-1">
                  {list.map((e) => (
                    <li key={e.id}>
                      <EventCard e={e} day={d} />
                    </li>
                  ))}
                  {!list.length && <li className="text-xs text-muted-foreground md:hidden">ไม่มีงาน</li>}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {view === "day" && (
        <div className="p-3" data-day={anchor}>
          {(byDay.get(anchor) ?? []).length ? (
            <ul className="space-y-2">
              {(byDay.get(anchor) ?? []).map((e) => (
                <li key={e.id}>
                  <EventCard e={e} day={anchor} detailed />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">ไม่มีงานในวันนี้</p>
          )}
        </div>
      )}
    </div>
  );
}
