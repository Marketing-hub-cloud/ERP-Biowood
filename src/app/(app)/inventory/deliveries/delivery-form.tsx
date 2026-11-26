"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/form-field";
import { DateTimeField } from "@/components/datetime-field";
import { SearchSelect } from "@/components/search-select";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { mapHref } from "@/lib/delivery";
import { deliveryJobSchema } from "@/lib/validators";
import type { DeliveryFormOptions } from "@/server/deliveries";

export type DeliveryValues = {
  goodsIssueId: string;
  startAt: string;
  endAt: string;
  driverId: string;
  mapUrl: string;
  shippingAddress: string;
  note: string;
};

export function DeliveryForm({
  jobId,
  initial,
  options,
  canEdit,
  issueLocked,
}: {
  jobId: string | null;
  initial: DeliveryValues;
  options: DeliveryFormOptions;
  canEdit: boolean;
  /** ใบนำออกเปลี่ยนไม่ได้ (สร้างจากหน้าใบนำออก) */
  issueLocked?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const editable = canEdit && !saving;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof DeliveryValues>(k: K, val: DeliveryValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const users = options.users.filter((u) => !u.inactive || u.id === v.driverId).map((u) => ({ value: u.id, label: u.name, hint: u.department ?? undefined }));
  const issues = options.issues.map((i) => ({ value: i.id, label: i.label }));
  const issue = options.issues.find((i) => i.id === v.goodsIssueId);
  const href = mapHref(v.mapUrl);

  async function save() {
    const parsed = deliveryJobSchema.safeParse(v);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      toast.error(Object.values(fe)[0] ?? "กรุณาตรวจสอบข้อมูล");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (!jobId) {
        const res = await api<{ id: string }>("/api/inventory/deliveries", { method: "POST", body: v });
        toast.success("สร้างงานจัดส่งแล้ว");
        router.push(`/inventory/deliveries/${res.id}`);
      } else {
        await api(`/api/inventory/deliveries/${jobId}`, { method: "PATCH", body: v });
        toast.success("บันทึกเรียบร้อย");
        router.refresh();
      }
    } catch (e) {
      if (e instanceof ApiClientError) setErrors(e.fields);
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
        <FormField label="ใบนำออก" htmlFor="goodsIssueId" required error={errors.goodsIssueId} className="sm:col-span-2">
          <SearchSelect
            id="goodsIssueId"
            value={v.goodsIssueId || null}
            onChange={(id) => {
              const gi = options.issues.find((i) => i.id === id);
              // ที่อยู่ยังว่าง → ใช้ที่อยู่จัดส่งของใบนำออก
              setV((s) => ({ ...s, goodsIssueId: id, shippingAddress: s.shippingAddress || gi?.shippingAddress || "" }));
            }}
            options={issues}
            placeholder="- เลือกใบนำออก -"
            disabled={!editable || issueLocked}
          />
          {issue && (
            <p className="mt-1 text-xs text-muted-foreground">
              <Link href={`/inventory/issues/${issue.id}`} className="text-primary hover:underline">
                เปิดใบนำออก {issue.docNo}
              </Link>
              {issue.contact || issue.recipientName ? ` · ผู้รับ: ${issue.recipientName || issue.contact}` : ""}
            </p>
          )}
        </FormField>
        <FormField label="วันเวลาเริ่มจัดส่ง" htmlFor="startAt" required error={errors.startAt}>
          <DateTimeField id="startAt" value={v.startAt} onChange={(x) => setV((s) => ({ ...s, startAt: x, endAt: !s.endAt || s.endAt < x ? x : s.endAt }))} disabled={!editable} />
        </FormField>
        <FormField label="วันเวลาสิ้นสุดจัดส่ง" htmlFor="endAt" required error={errors.endAt}>
          <DateTimeField id="endAt" value={v.endAt} onChange={(x) => set("endAt", x)} disabled={!editable} />
        </FormField>
        <FormField label="พนักงานจัดส่ง" htmlFor="driverId" required error={errors.driverId}>
          <SearchSelect id="driverId" value={v.driverId || null} onChange={(x) => set("driverId", x)} options={users} disabled={!editable} />
        </FormField>
        <FormField label="ลิงก์/พิกัด Google Map" htmlFor="mapUrl" error={errors.mapUrl}>
          <div className="flex gap-2">
            <Input id="mapUrl" value={v.mapUrl} onChange={(e) => set("mapUrl", e.target.value)} placeholder="https://maps.app.goo.gl/... หรือ 13.7563,100.5018" disabled={!editable} />
            {href && (
              <Button asChild variant="outline" size="icon" aria-label="เปิดแผนที่">
                <a href={href} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            )}
          </div>
        </FormField>
        <FormField label="ที่อยู่จัดส่ง" htmlFor="shippingAddress" error={errors.shippingAddress} className="sm:col-span-2">
          <Textarea id="shippingAddress" rows={3} value={v.shippingAddress} onChange={(e) => set("shippingAddress", e.target.value)} disabled={!editable} />
          {editable && issue?.shippingAddress && issue.shippingAddress !== v.shippingAddress && (
            <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => set("shippingAddress", issue.shippingAddress ?? "")}>
              ใช้ที่อยู่จัดส่งจากใบนำออก
            </button>
          )}
        </FormField>
        <FormField label="หมายเหตุ" htmlFor="note" error={errors.note} className="sm:col-span-2">
          <Textarea id="note" rows={2} value={v.note} onChange={(e) => set("note", e.target.value)} disabled={!editable} />
        </FormField>
        {canEdit && (
          <div className="flex justify-end sm:col-span-2">
            <Button type="button" onClick={() => void save()} disabled={saving || (!!jobId && !dirty)} className="w-full sm:w-auto">
              {saving ? "กำลังบันทึก..." : jobId ? "บันทึก" : "สร้างงานจัดส่ง"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
