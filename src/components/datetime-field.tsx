"use client";

import { DateField } from "@/components/date-field";
import { Input } from "@/components/ui/input";

/** วันที่ (DD/MM/YYYY) + เวลา (HH:mm) — ค่าเป็น "YYYY-MM-DDTHH:mm" ตามเวลาไทย */
export function DateTimeField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [date, time] = value ? value.split("T") : ["", ""];
  return (
    <div className="flex gap-2">
      <DateField id={id} value={date ?? ""} onChange={(d) => onChange(d ? `${d}T${time || "09:00"}` : "")} disabled={disabled} className="flex-1" />
      <Input
        id={`${id}-time`}
        type="time"
        aria-label="เวลา"
        className="w-28"
        value={time ?? ""}
        onChange={(e) => onChange(date ? `${date}T${e.target.value || "00:00"}` : "")}
        disabled={disabled || !date}
      />
    </div>
  );
}
