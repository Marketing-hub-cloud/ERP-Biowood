"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CalendarEvent = {
  id: string;
  title: string;
  /** ISO */
  start: string;
  end: string;
  href: string;
  className?: string;
  muted?: boolean;
};

const WEEKDAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** วันที่ไทย "YYYY-MM-DD" ของเวลา ISO */
export const bkkDay = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export const bkkTime = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(11, 16);

/** ช่วงวันที่ที่ปฏิทินเดือนนี้แสดง (เริ่มวันจันทร์ ครบ 6 สัปดาห์) */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // จันทร์ = 0
  const start = new Date(first.getTime() - offset * 86400_000);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86400_000).toISOString().slice(0, 10));
}

/** ปฏิทินรายเดือน: event หลายวันแสดงทุกวันที่ครอบคลุม */
export function MonthCalendar({
  year,
  month,
  onMonthChange,
  events,
  today,
  loading,
}: {
  year: number;
  month: number;
  onMonthChange: (y: number, m: number) => void;
  events: CalendarEvent[];
  today: string;
  loading?: boolean;
}) {
  const days = monthGrid(year, month);
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const s = bkkDay(e.start);
    const en = bkkDay(e.end) < s ? s : bkkDay(e.end);
    for (const d of days) if (d >= s && d <= en) byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  const shift = (n: number) => {
    const d = new Date(Date.UTC(year, month + n, 1));
    onMonthChange(d.getUTCFullYear(), d.getUTCMonth());
  };
  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;

  return (
    <div className="rounded-lg border bg-card" data-testid="month-calendar">
      <div className="flex items-center gap-2 border-b p-2">
        <Button type="button" variant="outline" size="icon-sm" onClick={() => shift(-1)} aria-label="เดือนก่อน">
          <ChevronLeft />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => shift(1)} aria-label="เดือนถัดไป">
          <ChevronRight />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const [y, m] = today.split("-").map(Number);
            onMonthChange(y, m - 1);
          }}
        >
          วันนี้
        </Button>
        <h2 className="font-medium" aria-live="polite">
          {MONTHS[month]} {year}
        </h2>
        {loading && <span className="text-xs text-muted-foreground">กำลังโหลด...</span>}
      </div>
      <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(ym);
          return (
            <div key={d} className={cn("min-h-20 border-r border-b p-1 text-xs sm:min-h-28", !inMonth && "bg-muted/40 text-muted-foreground")} data-day={d}>
              <div className={cn("mb-1 flex size-6 items-center justify-center rounded-full", d === today && "bg-primary font-medium text-primary-foreground")}>{Number(d.slice(8))}</div>
              <ul className="space-y-0.5">
                {list.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <Link
                      href={e.href}
                      title={e.title}
                      className={cn("block truncate rounded px-1 py-0.5 hover:opacity-80", e.className ?? "bg-primary/10 text-primary", e.muted && "line-through opacity-60")}
                    >
                      <span className="hidden tabular-nums sm:inline">{bkkDay(e.start) === d ? `${bkkTime(e.start)} ` : ""}</span>
                      {e.title}
                    </Link>
                  </li>
                ))}
                {list.length > 4 && <li className="px-1 text-muted-foreground">+{list.length - 4} รายการ</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
