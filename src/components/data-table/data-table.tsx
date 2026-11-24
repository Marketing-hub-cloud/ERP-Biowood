"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Filter, Rows3, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type DataColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  /** ซ่อนไว้เป็นค่าเริ่มต้น (เปิดได้จากปุ่ม Columns) */
  defaultHidden?: boolean;
  className?: string;
};

export type DataFilter = { id: string; label: string; options: { value: string; label: string }[] };

type Density = "compact" | "normal" | "comfortable";
const DENSITY_LABEL: Record<Density, string> = { compact: "กะทัดรัด", normal: "ปกติ", comfortable: "กว้าง" };
const DENSITY_CLASS: Record<Density, string> = { compact: "py-1", normal: "py-2.5", comfortable: "py-4" };
const PAGE_SIZES = [10, 20, 50, 100];
const ALL = "__all__";

type Props<T extends { id: string }> = {
  /** API ที่คืน { rows, total } และรองรับ ?format=csv */
  endpoint: string;
  columns: DataColumn<T>[];
  filters?: DataFilter[];
  /** คลิกแถวแล้วไปหน้ารายละเอียด */
  rowHref?: (row: T) => string;
  /** key สำหรับจำค่า density/columns ในเบราว์เซอร์ */
  storageKey: string;
  searchPlaceholder?: string;
  toolbarExtra?: ReactNode;
};

function loadPrefs(key: string): { density?: Density; visibility?: VisibilityState } {
  try {
    return JSON.parse(localStorage.getItem(`dt:${key}`) ?? "{}");
  } catch {
    return {};
  }
}
function savePrefs(key: string, prefs: { density: Density; visibility: VisibilityState }) {
  try {
    localStorage.setItem(`dt:${key}`, JSON.stringify(prefs));
  } catch {
    /* ไม่บังคับ */
  }
}

export function DataTable<T extends { id: string }>({
  endpoint,
  columns,
  filters = [],
  rowHref,
  storageKey,
  searchPlaceholder = "ค้นหา...",
  toolbarExtra,
}: Props<T>) {
  const router = useRouter();
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [density, setDensity] = useState<Density>("normal");
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(columns.filter((c) => c.defaultHidden).map((c) => [c.id, false])),
  );
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // โหลดค่าที่จำไว้ (หลัง mount เพื่อไม่ให้ hydration ไม่ตรง)
  useEffect(() => {
    const p = loadPrefs(storageKey);
    if (p.density) setDensity(p.density);
    if (p.visibility) setVisibility((v) => ({ ...v, ...p.visibility }));
    setPrefsLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (prefsLoaded) savePrefs(storageKey, { density, visibility });
  }, [storageKey, density, visibility, prefsLoaded]);

  // debounce ช่องค้นหา
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    for (const [k, v] of Object.entries(filterValues)) if (v) sp.set(`f_${k}`, v);
    if (sorting[0]) sp.set("sort", `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}`);
    return sp;
  }, [q, filterValues, sorting]);

  useEffect(() => {
    const ctrl = new AbortController();
    const sp = new URLSearchParams(query);
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    setLoading(true);
    fetch(`${endpoint}?${sp}`, { signal: ctrl.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "โหลดข้อมูลไม่สำเร็จ");
        setRows(data.rows);
        setTotal(data.total);
        setError(null);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [endpoint, query, page, pageSize]);

  const columnDefs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        enableSorting: Boolean(c.sortable),
        cell: ({ row }) => c.cell(row.original),
        meta: { className: c.className },
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    state: { sorting, columnVisibility: visibility },
    onSortingChange: (u) => {
      setSorting(u);
      setPage(1);
    },
    onColumnVisibilityChange: setVisibility,
    getRowId: (r) => r.id,
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const activeFilters = Object.values(filterValues).filter(Boolean).length;
  const exportHref = `${endpoint}?${new URLSearchParams([...query.entries(), ["format", "csv"]])}`;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="pl-8" aria-label="ค้นหา" />
        </div>

        {filters.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Filter /> Filters
                {activeFilters > 0 && <Badge className="ml-1 h-4 px-1.5 text-[10px]">{activeFilters}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-3">
              {filters.map((f) => (
                <div key={f.id} className="space-y-1">
                  <Label className="text-xs">{f.label}</Label>
                  <Select
                    value={filterValues[f.id] || ALL}
                    onValueChange={(v) => {
                      setFilterValues((fv) => ({ ...fv, [f.id]: v === ALL ? "" : v }));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>ทั้งหมด</SelectItem>
                      {f.options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" className="w-full" onClick={() => setFilterValues({})}>
                  <X /> ล้างตัวกรอง
                </Button>
              )}
            </PopoverContent>
          </Popover>
        )}

        <div className="flex-1" />

        <Button variant="outline" size="sm" asChild>
          <a href={exportHref} download>
            <Download /> Export
          </a>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="ความหนาแน่นของตาราง">
              <Rows3 /> Density
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as Density)}>
              {(Object.keys(DENSITY_LABEL) as Density[]).map((d) => (
                <DropdownMenuRadioItem key={d} value={d}>
                  {DENSITY_LABEL[d]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>แสดงคอลัมน์</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table.getAllLeafColumns().map((col) => (
              <DropdownMenuCheckboxItem
                key={col.id}
                checked={col.getIsVisible()}
                onCheckedChange={(v) => col.toggleVisibility(Boolean(v))}
                onSelect={(e) => e.preventDefault()}
              >
                {String(col.columnDef.header)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {toolbarExtra}
      </div>

      <div className="relative overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  return (
                    <TableHead key={h.id} className="whitespace-nowrap">
                      {h.column.getCanSort() ? (
                        <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <ArrowUp className="size-3.5" /> : sorted === "desc" ? <ArrowDown className="size-3.5" /> : <ArrowUpDown className="size-3.5 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className={cn(loading && "opacity-60")}>
            {error ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10 text-center text-destructive">
                  {error}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10 text-center text-muted-foreground">
                  {loading ? "กำลังโหลด..." : "ไม่พบข้อมูล"}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(rowHref && "cursor-pointer")}
                  onClick={rowHref ? () => router.push(rowHref(row.original)) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(DENSITY_CLASS[density], (cell.column.columnDef.meta as { className?: string } | undefined)?.className)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t p-3 text-sm">
        <span className="text-muted-foreground">ทั้งหมด {formatNumber(total)} รายการ</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">แถวต่อหน้า</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span>
          หน้า {page} / {pageCount}
        </span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="หน้าก่อนหน้า">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} aria-label="หน้าถัดไป">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
