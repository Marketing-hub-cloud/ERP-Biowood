"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/client-api";
import type { DeliveryAction } from "@/lib/delivery";

/** ปุ่ม "ส่งแล้ว" / "ยกเลิกงาน" (มี confirm dialog) */
export function DeliveryActions({ jobId, allowed }: { jobId: string; allowed: Partial<Record<DeliveryAction, boolean>> }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<DeliveryAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!allowed.deliver && !allowed.cancel) return null;

  async function run() {
    if (!confirm) return;
    setBusy(true);
    try {
      await api(`/api/inventory/deliveries/${jobId}/actions`, { method: "POST", body: { action: confirm, reason } });
      toast.success(confirm === "deliver" ? "บันทึกส่งแล้ว" : "ยกเลิกงานจัดส่งแล้ว");
      setConfirm(null);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {allowed.deliver && (
        <Button type="button" size="lg" className="w-full" onClick={() => setConfirm("deliver")}>
          <CheckCircle2 /> ส่งแล้ว
        </Button>
      )}
      {allowed.cancel && (
        <Button type="button" size="lg" variant="outline" className="w-full" onClick={() => setConfirm("cancel")}>
          <XCircle /> ยกเลิกงาน
        </Button>
      )}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "deliver" ? "ยืนยันส่งสินค้าแล้ว" : "ยกเลิกงานจัดส่ง"}</DialogTitle>
            <DialogDescription>{confirm === "deliver" ? "เปลี่ยนสถานะงานเป็น “ส่งแล้ว” และแก้ไขต่อไม่ได้" : "ยกเลิกแล้วแก้ไขหรือเปลี่ยนสถานะต่อไม่ได้"}</DialogDescription>
          </DialogHeader>
          {confirm === "cancel" && <Textarea aria-label="เหตุผลการยกเลิก" placeholder="เหตุผล (ไม่บังคับ)" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)} disabled={busy}>
              ปิด
            </Button>
            <Button type="button" variant={confirm === "cancel" ? "destructive" : "default"} onClick={() => void run()} disabled={busy}>
              {busy ? "กำลังบันทึก..." : "ยืนยัน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
