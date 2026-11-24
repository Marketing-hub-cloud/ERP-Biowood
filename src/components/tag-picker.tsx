"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client-api";

type Tag = { id: string; name: string };

/** เลือกกลุ่ม (tag) หลายอัน: พิมพ์ชื่อแล้วกด Enter — ถ้ายังไม่มีจะสร้างใหม่ */
export function TagPicker({
  value,
  onChange,
  tags,
  onTagAdded,
  disabled,
  canAdd,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  tags: Tag[];
  onTagAdded: (t: Tag) => void;
  disabled?: boolean;
  canAdd?: boolean;
}) {
  const listId = useId();
  const [input, setInput] = useState("");
  const byId = new Map(tags.map((t) => [t.id, t]));

  async function commit() {
    const name = input.trim();
    if (!name) return;
    let tag = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (!tag) {
      if (!canAdd) return toast.error("ไม่พบกลุ่มนี้");
      try {
        tag = await api<Tag>("/api/tags", { method: "POST", body: { name } });
        onTagAdded(tag);
      } catch (err) {
        return toast.error(errorMessage(err));
      }
    }
    if (!value.includes(tag.id)) onChange([...value, tag.id]);
    setInput("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-sm text-muted-foreground">ยังไม่มีกลุ่ม</span>}
        {value.map((id) => (
          <Badge key={id} variant="secondary" className="gap-1 pr-1">
            {byId.get(id)?.name ?? id}
            {!disabled && (
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`เอา ${byId.get(id)?.name} ออก`} className="rounded hover:bg-foreground/10">
                <X className="size-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {!disabled && (
        <>
          <Input
            list={listId}
            value={input}
            placeholder={canAdd ? "พิมพ์ชื่อกลุ่มแล้วกด Enter" : "เลือกกลุ่ม"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={() => {
              // เลือกจาก datalist ด้วยเมาส์แล้วออกจากช่อง → เพิ่มให้ถ้าตรงกับกลุ่มที่มีอยู่
              if (tags.some((t) => t.name === input.trim())) commit();
            }}
            aria-label="เพิ่มกลุ่ม"
          />
          <datalist id={listId}>
            {tags
              .filter((t) => !value.includes(t.id))
              .map((t) => (
                <option key={t.id} value={t.name} />
              ))}
          </datalist>
        </>
      )}
    </div>
  );
}
