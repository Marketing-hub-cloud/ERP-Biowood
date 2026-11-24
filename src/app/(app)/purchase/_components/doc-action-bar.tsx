"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { api, errorMessage } from "@/lib/client-api";
import type { PurchaseStatus } from "@/lib/approval";

type Kind = "requests" | "orders" | "returns";
type Action = "submit" | "approve" | "reject" | "cancel";

const DIALOG: Record<Exclude<Action, "submit">, { title: string; label: string; required: boolean; button: string; destructive: boolean }> = {
  approve: { title: "อนุมัติเอกสาร", label: "ความเห็น (ไม่บังคับ)", required: false, button: "ยืนยันอนุมัติ", destructive: false },
  reject: { title: "ไม่อนุมัติ", label: "เหตุผลที่ไม่อนุมัติ", required: true, button: "ยืนยันไม่อนุมัติ", destructive: true },
  cancel: { title: "ยกเลิกเอกสาร", label: "เหตุผลการยกเลิก", required: true, button: "ยืนยันยกเลิกเอกสาร", destructive: true },
};

/**
 * แถบปุ่มท้ายฟอร์มเอกสารจัดซื้อ: ยกเลิก | (ปุ่มเสริม) บันทึก ส่งอนุมัติ ไม่อนุมัติ อนุมัติ
 * onSave คืน true เมื่อบันทึกสำเร็จ — "ส่งอนุมัติ" จะบันทึกก่อนถ้ามีการแก้ไข
 */
export function DocActionBar({
  kind,
  docId,
  docNo,
  status,
  dirty,
  saving,
  canEdit,
  canApproveNow,
  canCancel,
  onSave,
  extra,
}: {
  kind: Kind;
  docId: string | null;
  docNo?: string;
  status: PurchaseStatus | null;
  dirty: boolean;
  saving: boolean;
  canEdit: boolean;
  canApproveNow: boolean;
  canCancel: boolean;
  onSave: () => Promise<boolean>;
  extra?: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Exclude<Action, "submit"> | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const isDraft = !docId || status === "DRAFT";
  const disabled = busy || saving;

  async function run(action: Action, text?: string) {
    if (!docId) return false;
    setBusy(true);
    try {
      await api(`/api/purchase/${kind}/${docId}/actions`, { method: "POST", body: { action, comment: text ?? null } });
      const msg = { submit: "ส่งอนุมัติแล้ว", approve: "อนุมัติแล้ว", reject: "ไม่อนุมัติ — เอกสารกลับเป็นร่าง", cancel: "ยกเลิกเอกสารแล้ว" }[action];
      toast.success(docNo ? `${docNo}: ${msg}` : msg);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (dirty && !(await onSave())) return;
    await run("submit");
  }

  async function confirmDialog() {
    if (!dialog) return;
    const cfg = DIALOG[dialog];
    if (cfg.required && !comment.trim()) {
      setError(`กรุณากรอก${cfg.label}`);
      return;
    }
    if (await run(dialog, comment.trim() || undefined)) {
      setDialog(null);
      setComment("");
    }
  }

  const showCancel = canCancel && docId && status !== "CANCELLED";
  if (!showCancel && !(canEdit && isDraft) && !canApproveNow && !extra) return null;

  return (
    <>
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        {showCancel && (
          <Button type="button" variant="outline" className="mr-auto text-destructive" onClick={() => setDialog("cancel")} disabled={disabled}>
            ยกเลิกเอกสาร
          </Button>
        )}
        {extra}
        {canEdit && isDraft && (
          <>
            <Button type="button" variant={docId ? "outline" : "default"} onClick={() => void onSave()} disabled={disabled || (!!docId && !dirty)}>
              {saving ? "กำลังบันทึก..." : docId ? "บันทึก" : "บันทึกร่าง"}
            </Button>
            {docId && (
              <Button type="button" onClick={submit} disabled={disabled}>
                <Send /> ส่งอนุมัติ
              </Button>
            )}
          </>
        )}
        {canApproveNow && (
          <>
            <Button type="button" variant="outline" className="text-destructive" onClick={() => setDialog("reject")} disabled={disabled}>
              <X /> ไม่อนุมัติ
            </Button>
            <Button type="button" onClick={() => setDialog("approve")} disabled={disabled}>
              <Check /> อนุมัติ
            </Button>
          </>
        )}
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setError(undefined);
          }
        }}
      >
        {dialog && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {DIALOG[dialog].title} {docNo}
              </DialogTitle>
              <DialogDescription>
                {dialog === "reject" ? "เอกสารจะกลับเป็นร่างให้ผู้สร้างแก้ไขแล้วส่งใหม่" : dialog === "cancel" ? "ยกเลิกแล้วแก้ไขหรือนำกลับมาใช้ไม่ได้" : "ยืนยันการอนุมัติลำดับปัจจุบัน"}
              </DialogDescription>
            </DialogHeader>
            <FormField label={DIALOG[dialog].label} htmlFor="actionComment" required={DIALOG[dialog].required} error={error}>
              <Textarea
                id="actionComment"
                rows={3}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  setError(undefined);
                }}
              />
            </FormField>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)} disabled={busy}>
                ปิด
              </Button>
              <Button variant={DIALOG[dialog].destructive ? "destructive" : "default"} onClick={confirmDialog} disabled={busy}>
                {busy ? "กำลังดำเนินการ..." : DIALOG[dialog].button}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
