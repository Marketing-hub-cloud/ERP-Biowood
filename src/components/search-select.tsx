"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; hint?: string; disabled?: boolean };

/** dropdown ที่พิมพ์ค้นหาได้ (กรองฝั่ง client) */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "- เลือก -",
  disabled,
  className,
  "aria-invalid": invalid,
}: {
  id?: string;
  value: string | null;
  onChange: (v: string) => void;
  options: SearchOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(s)) : options;
    return list.slice(0, 100);
  }, [q, options]);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์เพื่อค้นหา..." className="mb-2 h-8" aria-label="ค้นหา" />
        <div role="listbox" className="max-h-64 overflow-y-auto">
          {filtered.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">ไม่พบข้อมูล</p>}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              disabled={o.disabled}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
                setQ("");
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <Check className={cn("size-4 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
