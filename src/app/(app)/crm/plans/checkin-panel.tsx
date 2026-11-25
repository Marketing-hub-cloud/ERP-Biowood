"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Navigation, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/client-api";
import { geoErrorMessage, PLAN_ACTION_LABELS, type PlanAction } from "@/lib/crm";

type Allowed = Partial<Record<PlanAction, boolean>>;

/** ขอพิกัดจาก Geolocation API ของเบราว์เซอร์ (ความแม่นยำสูง, รอไม่เกิน 20 วิ) */
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  });
}

/**
 * ปุ่มเช็คอิน (ออกแบบให้กดบนมือถือได้ง่าย: ปุ่มใหญ่เต็มความกว้าง)
 * เช็คอิน = ขอพิกัด → ส่งให้ server (เวลาเช็คอินใช้เวลาของ server)
 */
export function CheckinPanel({ planId, allowed }: { planId: string; allowed: Allowed }) {
  const router = useRouter();
  const [busy, setBusy] = useState<PlanAction | null>(null);
  const [confirm, setConfirm] = useState<"complete" | "cancel" | null>(null);
  const [reason, setReason] = useState("");

  async function send(action: PlanAction, extra: Record<string, unknown> = {}) {
    await api(`/api/crm/plans/${planId}/actions`, { method: "POST", body: { action, ...extra } });
  }

  async function checkin(action: "checkin_start" | "checkin_end") {
    setBusy(action);
    try {
      let pos: GeolocationPosition;
      try {
        pos = await getPosition();
      } catch (e) {
        toast.error(geoErrorMessage((e as { code?: number })?.code));
        return;
      }
      await send(action, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      toast.success(`${PLAN_ACTION_LABELS[action]}แล้ว`);
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(confirm);
    try {
      await send(confirm, confirm === "cancel" ? { reason: reason.trim() || null } : {});
      toast.success(confirm === "cancel" ? "ยกเลิกแผนแล้ว" : "บันทึกเสร็จสิ้นแล้ว");
      setConfirm(null);
      setReason("");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!Object.values(allowed).some(Boolean)) return null;
  const disabled = busy !== null;

  return (
    <div className="space-y-2" data-testid="checkin-panel">
      {allowed.checkin_start && (
        <Button type="button" size="lg" className="h-14 w-full text-base" onClick={() => void checkin("checkin_start")} disabled={disabled}>
          <MapPin className="size-5" /> {busy === "checkin_start" ? "กำลังหาตำแหน่ง..." : PLAN_ACTION_LABELS.checkin_start}
        </Button>
      )}
      {allowed.checkin_end && (
        <Button type="button" size="lg" className="h-14 w-full text-base" onClick={() => void checkin("checkin_end")} disabled={disabled}>
          <Navigation className="size-5" /> {busy === "checkin_end" ? "กำลังหาตำแหน่ง..." : PLAN_ACTION_LABELS.checkin_end}
        </Button>
      )}
      <div className="grid grid-cols-2 gap-2">
        {allowed.complete && (
          <Button type="button" variant="outline" className="h-11" onClick={() => setConfirm("complete")} disabled={disabled}>
            <CheckCircle2 /> เสร็จสิ้น
          </Button>
        )}
        {allowed.cancel && (
          <Button type="button" variant="outline" className="h-11 text-destructive" onClick={() => setConfirm("cancel")} disabled={disabled}>
            <XCircle /> ยกเลิก
          </Button>
        )}
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm === "cancel" ? "ยกเลิกแผนการทำงาน" : "เสร็จสิ้นโดยไม่เช็คอิน"}</DialogTitle>
              <DialogDescription>
                {confirm === "cancel" ? "ยกเลิกแล้วเช็คอินหรือแก้ไขแผนนี้ไม่ได้อีก" : "บันทึกว่าเสร็จสิ้นโดยไม่บันทึกพิกัดจุดหมาย (ไม่มีระยะทาง)"}
              </DialogDescription>
            </DialogHeader>
            {confirm === "cancel" && <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล (ไม่บังคับ)" aria-label="เหตุผลการยกเลิก" />}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)} disabled={disabled}>
                ปิด
              </Button>
              <Button variant={confirm === "cancel" ? "destructive" : "default"} onClick={() => void runConfirm()} disabled={disabled}>
                {confirm === "cancel" ? "ยืนยันยกเลิก" : "ยืนยันเสร็จสิ้น"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
