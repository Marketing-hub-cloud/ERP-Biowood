"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ProjectOption } from "@/server/projects";

export type PickedProject = Pick<ProjectOption, "id" | "name" | "customer">;

/** เลือกโครงการ CRM (ค้นหาจาก server) — customerId = กรองเฉพาะโครงการของลูกค้านั้น */
export function ProjectPicker({
  id,
  value,
  onChange,
  customerId,
  disabled,
}: {
  id?: string;
  value: PickedProject | null;
  onChange: (p: PickedProject | null) => void;
  customerId?: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      const sp = new URLSearchParams({ q });
      if (customerId) sp.set("customerId", customerId);
      fetch(`/api/crm/projects/options?${sp}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((d: ProjectOption[]) => setRows(d))
        .catch(() => undefined)
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, q, customerId]);

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className={cn("min-w-0 flex-1 justify-between font-normal", !value && "text-muted-foreground")}
          >
            <span className="truncate">{value ? value.name : "- เลือกโครงการ (ไม่บังคับ) -"}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อโครงการ ลูกค้า..." className="mb-2 h-8" aria-label="ค้นหาโครงการ" />
          <div role="listbox" className="max-h-64 overflow-y-auto">
            {loading && rows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">กำลังค้นหา...</p>}
            {!loading && rows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">ไม่พบโครงการ</p>}
            {rows.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === value?.id}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
                className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{p.name}</span>
                <span className="truncate text-xs text-muted-foreground">{p.customer.name}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="ล้างโครงการ">
          <X />
        </Button>
      )}
    </div>
  );
}
