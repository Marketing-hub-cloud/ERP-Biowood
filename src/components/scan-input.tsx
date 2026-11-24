"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ScanInputHandle = { focus: () => void };

/**
 * ช่องรับ barcode จากเครื่องสแกน (เครื่องสแกนพิมพ์เป็นคีย์บอร์ดแล้วกด Enter)
 * พิมพ์เองแล้วกด Enter ก็ได้ — ล้างช่องทันทีและคง focus ไว้
 * สแกนรัวได้: เก็บเข้าคิวแล้วประมวลผลทีละรายการตามลำดับ (ไม่ทิ้งรายการที่สแกนระหว่างรอ server)
 */
export const ScanInput = forwardRef<
  ScanInputHandle,
  { onScan: (barcode: string) => Promise<void> | void; disabled?: boolean; placeholder?: string; className?: string; id?: string }
>(function ScanInput({ onScan, disabled, placeholder = "สแกน barcode หรือพิมพ์แล้วกด Enter", className, id }, ref) {
  const input = useRef<HTMLInputElement>(null);
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(0);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));

  async function drain() {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const code = queue.current.shift()!;
        setPending(queue.current.length + 1);
        try {
          await onScan(code);
        } catch {
          /* onScan แสดง error เอง */
        }
      }
    } finally {
      running.current = false;
      setPending(0);
    }
  }

  function submit() {
    const code = value.trim();
    setValue("");
    if (!code) return;
    queue.current.push(code);
    void drain();
  }

  return (
    <div className={cn("relative", className)}>
      <ScanBarcode className="pointer-events-none absolute top-1/2 left-2.5 size-5 -translate-y-1/2 text-primary" />
      <Input
        ref={input}
        id={id}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-label="สแกน barcode"
        className="h-11 pl-10 font-mono text-base"
      />
      {pending > 0 && (
        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground" aria-live="polite">
          กำลังตรวจ {pending} รายการ...
        </span>
      )}
    </div>
  );
});
