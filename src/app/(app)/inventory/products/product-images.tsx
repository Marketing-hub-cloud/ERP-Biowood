"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageUp, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/utils";

export const MAX_IMAGES = 10;
type Saved = { id: string; url: string };

function useObjectUrls(files: File[]) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

/**
 * รูปสินค้า (หลายรูป รูปแรก = รูปหลัก)
 * - โหมดสร้าง: เก็บไฟล์ไว้ก่อน (pending) อัปโหลดหลังบันทึกสินค้า
 * - โหมดแก้ไข: อัปโหลด/ลบ/ตั้งรูปหลัก ทันที
 */
export function ProductImages({
  productId,
  saved,
  pending,
  onPendingChange,
  canEdit,
}: {
  productId?: string;
  saved: Saved[];
  pending: File[];
  onPendingChange: (f: File[]) => void;
  canEdit: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingUrls = useObjectUrls(pending);
  const total = saved.length + pending.length;

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
    const room = MAX_IMAGES - total;
    if (files.length > room) toast.error(`อัปโหลดได้สูงสุด ${MAX_IMAGES} รูป`);
    const take = files.slice(0, Math.max(0, room));
    if (!take.length) return;
    if (!productId) return onPendingChange([...pending, ...take]);
    setBusy(true);
    try {
      for (const f of take) {
        const fd = new FormData();
        fd.append("file", f);
        await api(`/api/products/${productId}/images`, { method: "POST", body: fd });
      }
      toast.success("อัปโหลดรูปเรียบร้อย");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(imageId: string, method: "PATCH" | "DELETE") {
    setBusy(true);
    try {
      await api(`/api/products/${productId}/images/${imageId}`, { method });
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const tiles: { key: string; url: string; primary: boolean; onPrimary?: () => void; onRemove: () => void }[] = [
    ...saved.map((s, i) => ({ key: s.id, url: s.url, primary: i === 0, onPrimary: () => act(s.id, "PATCH"), onRemove: () => act(s.id, "DELETE") })),
    ...pending.map((f, i) => ({
      key: `p${i}-${f.name}`,
      url: pendingUrls[i],
      primary: saved.length === 0 && i === 0,
      onPrimary: () => onPendingChange([f, ...pending.filter((_, j) => j !== i)]),
      onRemove: () => onPendingChange(pending.filter((_, j) => j !== i)),
    })),
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.key} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted" data-testid="product-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.url} alt="" className="h-full w-full object-cover" />
            {t.primary && <Badge className="absolute top-1 left-1">รูปหลัก</Badge>}
            {canEdit && (
              <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                {!t.primary && t.onPrimary && (
                  <Button type="button" size="icon-sm" variant="secondary" onClick={t.onPrimary} disabled={busy} aria-label="ตั้งเป็นรูปหลัก">
                    <Star />
                  </Button>
                )}
                <Button type="button" size="icon-sm" variant="secondary" onClick={t.onRemove} disabled={busy} aria-label="ลบรูป">
                  <Trash2 />
                </Button>
              </div>
            )}
          </div>
        ))}
        {canEdit && total < MAX_IMAGES && (
          <button
            type="button"
            className={cn(
              "flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-muted/40 p-2 text-center text-xs text-muted-foreground hover:bg-muted",
              drag && "border-primary bg-primary/5",
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              addFiles(e.dataTransfer.files);
            }}
            disabled={busy}
          >
            <ImageUp className="size-6" />
            {busy ? "กำลังอัปโหลด..." : "ลากรูปมาวาง หรือคลิก"}
          </button>
        )}
      </div>
      {tiles.length === 0 && !canEdit && <p className="text-sm text-muted-foreground">ไม่มีรูป</p>}
      <p className="text-xs text-muted-foreground">PNG, JPG, WEBP ไม่เกิน 5MB · สูงสุด {MAX_IMAGES} รูป · รูปแรกเป็นรูปหลัก</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        data-testid="product-image-input"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
