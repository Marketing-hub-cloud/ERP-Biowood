"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/form-field";
import { api, errorMessage } from "@/lib/client-api";

type Props = { userId: string; status: "ACTIVE" | "INACTIVE"; statusNote: string | null; canChange: boolean };

export function UserStatusCard({ userId, status, statusNote, canChange }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const next = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  const actionLabel = next === "INACTIVE" ? "หยุดใช้งาน" : "เปิดใช้งาน";

  async function submit() {
    if (!note.trim()) {
      setError("กรุณากรอกหมายเหตุสถานะ");
      return;
    }
    setSaving(true);
    try {
      await api(`/api/users/${userId}/status`, { method: "POST", body: { status: next, statusNote: note } });
      toast.success(`${actionLabel}เรียบร้อย`);
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="text-base">สถานะบัญชี</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="text-muted-foreground">สถานะ</div>
          <div className="font-medium">{status === "ACTIVE" ? "ใช้งาน" : "หยุดใช้งาน"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">หมายเหตุสถานะ</div>
          <div>{statusNote || "-"}</div>
        </div>
        {canChange && (
          <Button variant={next === "INACTIVE" ? "destructive" : "default"} className="w-full" onClick={() => setOpen(true)}>
            {actionLabel}
          </Button>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionLabel}</DialogTitle>
            <DialogDescription>
              {next === "INACTIVE" ? "ผู้ใช้ที่ถูกหยุดใช้งานจะเข้าสู่ระบบไม่ได้ทันที" : "ผู้ใช้จะกลับมาเข้าสู่ระบบได้"}
            </DialogDescription>
          </DialogHeader>
          <FormField label="หมายเหตุสถานะ" htmlFor="statusNote" required error={error}>
            <Textarea
              id="statusNote"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setError(undefined);
              }}
              rows={3}
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button variant={next === "INACTIVE" ? "destructive" : "default"} onClick={submit} disabled={saving}>
              {saving ? "กำลังบันทึก..." : `ยืนยัน${actionLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
