"use client";

import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayToIso, isoToDisplay } from "@/lib/date-input";

/**
 * ช่องวันที่แสดงแบบ DD/MM/YYYY (ค.ศ.) — พิมพ์เองได้ หรือกดปุ่มปฏิทินของเบราว์เซอร์
 * ค่า value/onChange เป็น "YYYY-MM-DD" ("" = ไม่ระบุ)
 */
export function DateField({
  id,
  value,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? isoToDisplay(value);
  const invalid = draft !== null && draft.trim() !== "" && displayToIso(draft) === null;

  function commit(s: string) {
    if (!s.trim()) {
      onChange("");
      setDraft(null);
      return;
    }
    const iso = displayToIso(s);
    if (iso) {
      onChange(iso);
      setDraft(null);
    }
  }

  return (
    <div className={cn("relative flex", className)}>
      <Input
        id={id}
        value={text}
        placeholder="DD/MM/YYYY"
        inputMode="numeric"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        className="pr-9"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 h-full"
        disabled={disabled}
        aria-label="เลือกวันที่"
        tabIndex={-1}
        onClick={() => picker.current?.showPicker?.()}
      >
        <CalendarDays className="size-4" />
      </Button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute right-0 bottom-0 size-0 opacity-0"
        value={value}
        onChange={(e) => {
          setDraft(null);
          onChange(e.target.value);
        }}
      />
    </div>
  );
}
