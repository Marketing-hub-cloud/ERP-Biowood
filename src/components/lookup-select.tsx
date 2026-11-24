"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/client-api";

const NONE = "__none__";

type Option = { id: string; label: string };

/**
 * เลือกจากรายการ หรือพิมพ์ตัวเลือกใหม่แล้วกด "เพิ่ม" (บันทึกเป็นตัวเลือกใหม่ให้ทุกคนใช้)
 */
export function LookupSelect({
  id,
  kind,
  value,
  onChange,
  options,
  onOptionAdded,
  disabled,
  canAdd,
  placeholder = "เลือก",
}: {
  id?: string;
  kind: "CONTACT_SOURCE" | "CUSTOMER_BUSINESS_TYPE" | "PRODUCT_TYPE";
  value: string | null;
  onChange: (v: string | null) => void;
  options: Option[];
  onOptionAdded: (o: Option) => void;
  disabled?: boolean;
  canAdd?: boolean;
  placeholder?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!label.trim()) return;
    setSaving(true);
    try {
      const o = await api<Option>("/api/lookups", { method: "POST", body: { kind, label } });
      onOptionAdded(o);
      onChange(o.id);
      setLabel("");
      setAdding(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (adding) {
    return (
      <div className="flex gap-1.5">
        <Input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="พิมพ์ตัวเลือกใหม่"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
            if (e.key === "Escape") setAdding(false);
          }}
        />
        <Button type="button" size="sm" onClick={add} disabled={saving || !label.trim()}>
          <Check /> เพิ่ม
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => setAdding(false)} aria-label="ยกเลิก">
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>- ไม่ระบุ -</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canAdd && !disabled && (
        <Button type="button" variant="outline" size="icon" onClick={() => setAdding(true)} aria-label="เพิ่มตัวเลือกใหม่">
          <Plus />
        </Button>
      )}
    </div>
  );
}
