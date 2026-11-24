"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";

/** ยืนยันยกเลิกเอกสาร + กรอกเหตุผล */
export function CancelDocDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!reason.trim()) {
      setError("กรุณากรอกเหตุผลการยกเลิก");
      return;
    }
    setBusy(true);
    const ok = await onConfirm(reason.trim());
    setBusy(false);
    if (ok) {
      setReason("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormField label="เหตุผลการยกเลิก" htmlFor="cancelReason" required error={error}>
          <Textarea
            id="cancelReason"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(undefined);
            }}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            ปิด
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "กำลังยกเลิก..." : "ยืนยันยกเลิกเอกสาร"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
