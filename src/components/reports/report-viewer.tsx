"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateField } from "@/components/date-field";
import { SearchSelect } from "@/components/search-select";
import { formatNumber } from "@/lib/format";
import { REPORT_PREVIEW_LIMIT, type ReportCell, type ReportColumn, type ReportMeta, type ReportModule, type ReportRow } from "@/lib/reports";
import { cn } from "@/lib/utils";

const ALL = "__all__";

type Result = { columns: ReportColumn[]; rows: ReportRow[]; totals: ReportRow | null; total: number };

/** ค่าเริ่มต้นของตัวกรอง (ช่วงวันที่ = ต้นเดือนถึงวันนี้) */
function defaults(meta: ReportMeta, today: string): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of meta.filters) {
    if (f.type === "dateRange") {
      v.from = f.defaultEmpty ? "" : `${today.slice(0, 8)}01`;
      v.to = f.defaultEmpty ? "" : today;
    } else if (f.type === "date") v[f.id] = today;
    else v[f.id] = f.required ? (f.defaultValue ?? f.options[0]?.value ?? "") : "";
  }
  return v;
}

function cellText(c: ReportColumn, v: ReportCell): string {
  if (v === null || v === undefined || v === "") return c.type === "number" ? "" : "-";
  if (c.type === "number" && typeof v === "number") return c.decimals !== undefined ? formatNumber(v, c.decimals) : v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return String(v);
}

export function ReportViewer({ module, meta, today }: { module: ReportModule; meta: ReportMeta; today: string }) {
  const [values, setValues] = useState(() => defaults(meta, today));
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) if (v) sp.set(`f_${k}`, v);
    return sp.toString();
  }, [values]);
  const endpoint = `/api/reports/${module}/${meta.key}`;
  const loading = loadedQuery !== query;

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`${endpoint}?${query}`, { signal: ctrl.signal })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error ?? "โหลดรายงานไม่สำเร็จ");
          setResult(data as Result);
          setError(null);
        })
        .catch((e: Error) => {
          if (!ctrl.signal.aborted) setError(e.message);
        })
        .finally(() => !ctrl.signal.aborted && setLoadedQuery(query));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [endpoint, query]);

  return (
    <div className="space-y-4" data-testid="report-viewer" data-report={meta.key}>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        {meta.filters.map((f) =>
          f.type === "dateRange" ? (
            <div key="date" className="space-y-1">
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <div className="flex items-center gap-1">
                <DateField value={values.from ?? ""} onChange={(x) => set("from", x)} aria-label="ตั้งแต่วันที่" className="w-40" />
                <span className="text-muted-foreground">–</span>
                <DateField value={values.to ?? ""} onChange={(x) => set("to", x)} aria-label="ถึงวันที่" className="w-40" />
              </div>
            </div>
          ) : f.type === "date" ? (
            <div key={f.id} className="space-y-1">
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <DateField value={values[f.id] ?? ""} onChange={(x) => set(f.id, x)} aria-label={f.label} className="w-40" />
            </div>
          ) : (
            <div key={f.id} className="w-56 space-y-1">
              <Label htmlFor={`rf-${f.id}`} className="text-xs text-muted-foreground">
                {f.label}
              </Label>
              <SearchSelect
                id={`rf-${f.id}`}
                value={values[f.id] || (f.required ? null : ALL)}
                onChange={(x) => set(f.id, x === ALL ? "" : x)}
                options={f.required ? f.options : [{ value: ALL, label: f.allLabel ?? "ทั้งหมด" }, ...f.options]}
              />
            </div>
          ),
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline">
            <a href={`${endpoint}?${query}${query ? "&" : ""}format=csv`} download data-testid="report-export">
              <Download /> Export CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span aria-live="polite">
          {loading ? "กำลังโหลด..." : error ? <span className="text-destructive">{error}</span> : result ? `ทั้งหมด ${formatNumber(result.total)} แถว` : ""}
          {!loading && result && result.total > REPORT_PREVIEW_LIMIT && ` (แสดง ${formatNumber(REPORT_PREVIEW_LIMIT)} แถวแรก — Export CSV เพื่อดูครบ)`}
        </span>
      </div>

      {result && (
        <div className={cn("overflow-x-auto rounded-lg border bg-card", loading && "opacity-60")}>
          <Table data-testid="report-table">
            <TableHeader>
              <TableRow>
                {result.columns.map((c) => (
                  <TableHead key={c.key} className={cn("whitespace-nowrap", c.type === "number" && "text-right")}>
                    {c.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.length ? (
                result.rows.map((r, i) => (
                  <TableRow key={i}>
                    {result.columns.map((c) => (
                      <TableCell key={c.key} className={cn("max-w-80 truncate", c.type === "number" && "text-right tabular-nums")} title={typeof r[c.key] === "string" ? (r[c.key] as string) : undefined}>
                        {cellText(c, r[c.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={result.columns.length} className="py-10 text-center text-muted-foreground">
                    ไม่พบข้อมูล
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {result.totals && result.rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  {result.columns.map((c) => (
                    <TableCell key={c.key} className={cn("font-medium whitespace-nowrap", c.type === "number" && "text-right tabular-nums")}>
                      {result.totals?.[c.key] === undefined ? "" : cellText(c, result.totals[c.key])}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}
    </div>
  );
}
