"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchSelect } from "@/components/search-select";
import { AuditHistory } from "@/components/audit-history";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { MAX_APPROVAL_STEPS } from "@/lib/approval";

type User = { id: string; name: string; department: string | null };
type Step = { approvers: { id: string; name: string }[] };

/** ตั้งค่าผังอนุมัติของเอกสาร 1 ชนิด: สูงสุด 3 ลำดับ แต่ละลำดับมีผู้อนุมัติหลายคน */
export function ApprovalEditor({
  docType,
  title,
  initial,
  users,
  canEdit,
}: {
  docType: string;
  title: string;
  initial: Step[];
  users: User[];
  canEdit: boolean;
}) {
  const [steps, setSteps] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(steps) !== JSON.stringify(saved);

  async function save() {
    setSaving(true);
    try {
      const res = await api<{ stepNo: number; approvers: { id: string; name: string }[] }[]>(`/api/settings/approval/${docType}`, {
        method: "PUT",
        body: { steps: steps.map((s) => s.approvers.map((a) => a.id)) },
      });
      const next = res.map((s) => ({ approvers: s.approvers.map((a) => ({ id: a.id, name: a.name })) }));
      setSteps(next);
      setSaved(next);
      setErrors({});
      toast.success(`บันทึกผังอนุมัติ${title}แล้ว`);
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const update = (i: number, approvers: Step["approvers"]) => setSteps((s) => s.map((x, j) => (j === i ? { approvers } : x)));

  return (
    <Card data-testid={`approval-${docType}`}>
      <CardHeader className="flex flex-row items-start gap-2 space-y-0">
        <div className="mr-auto space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>
            {steps.length === 0 ? "ไม่มีการตั้งค่าการอนุมัติ — ผู้ที่มีสิทธิ์ \"อนุมัติ\" ของเมนูนี้กดอนุมัติได้เลย" : "ผู้อนุมัติคนใดคนหนึ่งในลำดับกดอนุมัติ ก็ไปลำดับถัดไปได้"}
          </CardDescription>
        </div>
        <AuditHistory entityType="ApprovalSetting" entityId={docType} />
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((s, i) => {
          const taken = new Set(s.approvers.map((a) => a.id));
          return (
            <div key={i} className="rounded-lg border p-3" data-testid="approval-step">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium">ลำดับ {i + 1}</span>
                <span className="flex-1" />
                {canEdit && (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`ลบลำดับ ${i + 1}`} onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {s.approvers.map((a) => (
                  <Badge key={a.id} variant="secondary" className="gap-1 py-1">
                    {a.name}
                    {canEdit && (
                      <button type="button" aria-label={`เอา ${a.name} ออก`} onClick={() => update(i, s.approvers.filter((x) => x.id !== a.id))}>
                        <X className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))}
                {canEdit && (
                  <div className="w-56">
                    <SearchSelect
                      id={`approver-${docType}-${i}`}
                      value={null}
                      onChange={(id) => {
                        const u = users.find((x) => x.id === id);
                        if (u) update(i, [...s.approvers, { id: u.id, name: u.name }]);
                      }}
                      options={users.filter((u) => !taken.has(u.id)).map((u) => ({ value: u.id, label: u.name, hint: u.department ?? undefined }))}
                      placeholder="+ เพิ่มผู้อนุมัติ"
                    />
                  </div>
                )}
              </div>
              {errors[`steps.${i}`] && <p className="mt-1 text-xs text-destructive">{errors[`steps.${i}`]}</p>}
            </div>
          );
        })}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {steps.length < MAX_APPROVAL_STEPS && (
              <Button type="button" variant="outline" size="sm" onClick={() => setSteps((s) => [...s, { approvers: [] }])}>
                <Plus /> เพิ่มลำดับ
              </Button>
            )}
            <span className="flex-1" />
            {dirty && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setSteps(saved)} disabled={saving}>
                ยกเลิกการแก้ไข
              </Button>
            )}
            <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
              {saving ? "กำลังบันทึก..." : "บันทึก"}
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">การเปลี่ยนผังมีผลกับเอกสารที่กด &quot;ส่งอนุมัติ&quot; หลังจากนี้ ใบที่รออนุมัติอยู่ใช้ผังเดิม</p>
      </CardContent>
    </Card>
  );
}
