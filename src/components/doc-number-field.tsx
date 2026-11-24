"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * ช่องเลขที่เอกสารในฟอร์ม + ปุ่มรีเฟรช
 * - เอกสารใหม่: แสดงเลขถัดไป (ตัวอย่าง ยังไม่จอง) เลขจริงออกตอนบันทึก
 * - เอกสารที่บันทึกแล้ว: ส่ง value มาแสดงอย่างเดียว
 */
export function DocNumberField({ prefix, value, id = "docNumber" }: { prefix: string; value?: string | null; id?: string }) {
  const [preview, setPreview] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/doc-number/preview?prefix=${prefix}`);
    const data = await res.json();
    if (res.ok) setPreview(data.number);
  }, [prefix]);

  async function refresh() {
    setLoading(true);
    try {
      await load();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (value) return;
    let cancelled = false;
    fetch(`/api/doc-number/preview?prefix=${prefix}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setPreview(d.number);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [value, prefix]);

  if (value) return <Input id={id} value={value} readOnly className="font-mono" />;

  return (
    <div className="flex gap-2">
      <Input id={id} value={preview} readOnly className="font-mono" title="เลขที่จริงจะออกเมื่อบันทึก" />
      <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={loading} aria-label="ขอเลขที่เอกสารใหม่">
        <RefreshCw className={loading ? "animate-spin" : undefined} />
      </Button>
    </div>
  );
}
