"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ContactOption } from "@/app/api/inventory/issues/contacts/route";

/** เลือกผู้ติดต่อ (ค้นหาจาก server) */
export function ContactPicker({
  id,
  value,
  onChange,
  customersOnly,
  disabled,
  invalid,
}: {
  id?: string;
  value: ContactOption | null;
  onChange: (c: ContactOption | null) => void;
  customersOnly: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      const sp = new URLSearchParams({ q });
      if (customersOnly) sp.set("customer", "1");
      fetch(`/api/inventory/issues/contacts?${sp}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((d: ContactOption[]) => setRows(d))
        .catch(() => undefined)
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, q, customersOnly]);

  return (
    <div className="flex gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn("min-w-0 flex-1 justify-between font-normal", !value && "text-muted-foreground")}
          >
            <span className="truncate">{value ? `${value.code} ${value.name}` : customersOnly ? "- เลือกลูกค้า -" : "- เลือกผู้ติดต่อ (ไม่บังคับ) -"}</span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ รหัส เลขผู้เสียภาษี..." className="mb-2 h-8" aria-label="ค้นหาผู้ติดต่อ" />
          <div role="listbox" className="max-h-64 overflow-y-auto">
            {loading && rows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">กำลังค้นหา...</p>}
            {!loading && rows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">ไม่พบผู้ติดต่อ</p>}
            {rows.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === value?.id}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                <span className="flex-1 truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="ล้างผู้ติดต่อ">
          <X />
        </Button>
      )}
    </div>
  );
}
