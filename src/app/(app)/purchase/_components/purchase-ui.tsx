"use client";

import { useEffect, useState } from "react";
import { Check, CircleDot, MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import {
  APPROVAL_ACTION_LABELS,
  STATUS_LABELS,
  statusSteps,
  type ApprovalDocType,
  type ApprovalSnapshot,
  type PurchaseStatus,
} from "@/lib/approval";
import type { ApprovalHistoryEntry } from "@/server/approval";

const STATUS_CLASS: Record<PurchaseStatus, string> = {
  DRAFT: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  PENDING: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  APPROVED: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  PARTIAL: "bg-violet-100 text-violet-800 hover:bg-violet-100",
  COMPLETED: "bg-emerald-600 text-white hover:bg-emerald-600",
  CANCELLED: "bg-muted text-muted-foreground line-through hover:bg-muted",
};

export function PurchaseStatusBadge({ docType, status }: { docType: ApprovalDocType; status: PurchaseStatus }) {
  return <Badge className={STATUS_CLASS[status]}>{STATUS_LABELS[docType][status]}</Badge>;
}

/** stepper แนวนอนที่หัวเอกสาร */
export function StatusStepper({ docType, status }: { docType: ApprovalDocType; status: PurchaseStatus }) {
  const steps = statusSteps(docType, status);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs sm:text-sm" aria-label="สถานะเอกสาร" data-testid="status-stepper">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
              s.state === "done" && "border-primary/40 bg-primary/10 text-primary",
              s.state === "current" && "border-primary bg-primary font-medium text-primary-foreground",
              s.state === "todo" && "text-muted-foreground",
            )}
          >
            {s.state === "done" ? <Check className="size-3.5" /> : <span className="tabular-nums">{i + 1}</span>}
            <span data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
              {s.label}
            </span>
          </span>
          {i < steps.length - 1 && <span className="h-px w-3 bg-border sm:w-5" />}
        </li>
      ))}
      {status === "CANCELLED" && <PurchaseStatusBadge docType={docType} status="CANCELLED" />}
    </ol>
  );
}

/** ผังอนุมัติ (ลำดับ/ผู้อนุมัติ) + ประวัติการอนุมัติ */
export function ApprovalPanel({
  status,
  snapshot,
  currentStep,
  configPreview,
  history,
}: {
  status: PurchaseStatus;
  snapshot: ApprovalSnapshot | null;
  currentStep: number | null;
  /** ผังปัจจุบันในตั้งค่า (แสดงตอนยังเป็นร่าง) */
  configPreview: { stepNo: number; approvers: { name: string }[] }[];
  history: ApprovalHistoryEntry[];
}) {
  const usingSnapshot = status !== "DRAFT" && snapshot;
  const steps = usingSnapshot
    ? snapshot.steps.map((s) => ({ stepNo: s.stepNo, names: s.approverNames }))
    : configPreview.map((s) => ({ stepNo: s.stepNo, names: s.approvers.map((a) => a.name) }));
  const lastRound = Math.max(0, ...history.map((h) => h.round));
  const approvedSteps = new Set(history.filter((h) => h.round === lastRound && h.action === "APPROVE" && h.stepNo).map((h) => h.stepNo));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">การอนุมัติ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {steps.length === 0 ? (
          <p className="text-muted-foreground">ไม่มีการตั้งค่าการอนุมัติ — ผู้มีสิทธิ์ &quot;อนุมัติ&quot; กดอนุมัติได้</p>
        ) : (
          <ol className="space-y-2" data-testid="approval-steps">
            {steps.map((s) => {
              const done = usingSnapshot && (approvedSteps.has(s.stepNo) || ["APPROVED", "PARTIAL", "COMPLETED"].includes(status));
              const current = status === "PENDING" && currentStep === s.stepNo;
              return (
                <li key={s.stepNo} className={cn("flex items-start gap-2 rounded-md border p-2", current && "border-sky-400 bg-sky-50", done && "border-emerald-300 bg-emerald-50")}>
                  {done ? <Check className="mt-0.5 size-4 text-emerald-700" /> : <CircleDot className={cn("mt-0.5 size-4", current ? "text-sky-600" : "text-muted-foreground")} />}
                  <div>
                    <div className="font-medium">
                      ลำดับ {s.stepNo} {current && <span className="text-sky-700">(รออนุมัติ)</span>}
                    </div>
                    <div className="text-muted-foreground">{s.names.join(", ")} · คนใดคนหนึ่งอนุมัติได้</div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {!usingSnapshot && steps.length > 0 && <p className="text-xs text-muted-foreground">ผังนี้จะถูกใช้เมื่อกด &quot;ส่งอนุมัติ&quot;</p>}

        <div>
          <div className="mb-1 font-medium">ประวัติ</div>
          {history.length === 0 ? (
            <p className="text-muted-foreground">ยังไม่มี</p>
          ) : (
            <ul className="space-y-1.5" data-testid="approval-history">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2">
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(h.createdAt)}</span>
                  <span className={cn("font-medium", h.action === "REJECT" && "text-destructive", h.action === "APPROVE" && "text-emerald-700")}>
                    {APPROVAL_ACTION_LABELS[h.action]}
                    {h.stepNo ? ` ลำดับ ${h.stepNo}` : ""}
                  </span>
                  <span>{h.actorName}</span>
                  {h.comment && (
                    <span className="flex basis-full items-start gap-1 text-muted-foreground">
                      <MessageSquareText className="mt-0.5 size-3.5 shrink-0" /> {h.comment}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type Template = { id: string; title: string; body: string };

/** เลือกหมายเหตุสำเร็จรูป แล้วแทรกต่อท้ายข้อความเดิม (แก้ต่อได้) */
export function NoteTemplatePicker({ module, value, onChange, disabled }: { module: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [items, setItems] = useState<Template[]>([]);
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    fetch(`/api/settings/note-templates?module=${module}&active=1`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Template[]) => !cancelled && setItems(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [module, disabled]);
  if (disabled || !items.length) return null;
  return (
    <Select
      value="__none__"
      onValueChange={(id) => {
        const t = items.find((x) => x.id === id);
        if (t) onChange(value.trim() ? `${value.trimEnd()}\n${t.body}` : t.body);
      }}
    >
      <SelectTrigger size="sm" className="mb-1.5 w-full sm:w-72" aria-label="เลือกหมายเหตุสำเร็จรูป">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">- เลือกหมายเหตุสำเร็จรูป -</SelectItem>
        {items.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
