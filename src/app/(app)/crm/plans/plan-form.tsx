"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/form-field";
import { DateTimeField } from "@/components/datetime-field";
import { SearchSelect } from "@/components/search-select";
import { ContactPicker } from "@/components/contact-picker";
import { ProjectPicker, type PickedProject } from "@/components/project-picker";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { workPlanSchema } from "@/lib/validators";
import type { PlanFormOptions } from "@/server/work-plans";
import type { ContactOption } from "@/app/api/contact-options/route";

export type PlanValues = {
  subject: string;
  plannedStart: string;
  plannedEnd: string;
  employeeId: string;
  customer: ContactOption | null;
  project: PickedProject | null;
  location: string;
  detail: string;
};

const payload = (v: PlanValues) => ({
  subject: v.subject,
  plannedStart: v.plannedStart,
  plannedEnd: v.plannedEnd,
  employeeId: v.employeeId,
  customerId: v.customer?.id ?? null,
  projectId: v.project?.id ?? null,
  location: v.location,
  detail: v.detail,
});

export function PlanForm({
  planId,
  initial,
  options,
  canEdit,
  canChangeEmployee,
}: {
  planId: string | null;
  initial: PlanValues;
  options: PlanFormOptions;
  canEdit: boolean;
  canChangeEmployee: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const editable = canEdit && !saving;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof PlanValues>(k: K, val: PlanValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const err = (k: string) => errors[k];
  const users = options.users.filter((u) => !u.inactive || u.id === v.employeeId).map((u) => ({ value: u.id, label: u.name, hint: u.department ?? undefined }));

  async function save() {
    const body = payload(v);
    const parsed = workPlanSchema.safeParse(body);
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
      if (!planId) {
        const res = await api<{ id: string }>("/api/crm/plans", { method: "POST", body });
        toast.success("สร้างแผนการทำงานแล้ว");
        router.push(`/crm/plans/${res.id}`);
      } else {
        await api(`/api/crm/plans/${planId}`, { method: "PATCH", body });
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
        <FormField label="เรื่อง" htmlFor="subject" required error={err("subject")} className="sm:col-span-2">
          <Input id="subject" value={v.subject} onChange={(e) => set("subject", e.target.value)} disabled={!editable} />
        </FormField>
        <FormField label="วันเวลาเริ่ม (วางแผน)" htmlFor="plannedStart" required error={err("plannedStart")}>
          <DateTimeField
            id="plannedStart"
            value={v.plannedStart}
            onChange={(x) => setV((s) => ({ ...s, plannedStart: x, plannedEnd: !s.plannedEnd || s.plannedEnd < x ? x : s.plannedEnd }))}
            disabled={!editable}
          />
        </FormField>
        <FormField label="วันเวลาสิ้นสุด (วางแผน)" htmlFor="plannedEnd" required error={err("plannedEnd")}>
          <DateTimeField id="plannedEnd" value={v.plannedEnd} onChange={(x) => set("plannedEnd", x)} disabled={!editable} />
        </FormField>
        <FormField label="พนักงาน" htmlFor="employeeId" required error={err("employeeId")}>
          <SearchSelect id="employeeId" value={v.employeeId || null} onChange={(x) => set("employeeId", x)} options={users} disabled={!editable || !canChangeEmployee} />
        </FormField>
        <FormField label="สถานที่" htmlFor="location" error={err("location")}>
          <Input id="location" value={v.location} onChange={(e) => set("location", e.target.value)} disabled={!editable} />
        </FormField>
        <FormField label="ลูกค้า" htmlFor="customerId" error={err("customerId")}>
          <ContactPicker
            id="customerId"
            role="customer"
            value={v.customer}
            onChange={(c) => setV((s) => ({ ...s, customer: c, project: c && s.project && s.project.customer.id !== c.id ? null : s.project }))}
            disabled={!editable}
          />
        </FormField>
        <FormField label="โครงการ" htmlFor="projectId" error={err("projectId")}>
          <ProjectPicker
            id="projectId"
            value={v.project}
            customerId={v.customer?.id}
            onChange={(p) => setV((s) => ({ ...s, project: p, customer: p ? p.customer : s.customer }))}
            disabled={!editable}
          />
        </FormField>
        <FormField label="รายละเอียด" htmlFor="detail" error={err("detail")} className="sm:col-span-2">
          <Textarea id="detail" rows={3} value={v.detail} onChange={(e) => set("detail", e.target.value)} disabled={!editable} />
        </FormField>
        {canEdit && (
          <div className="flex justify-end sm:col-span-2">
            <Button type="button" onClick={() => void save()} disabled={saving || (!!planId && !dirty)} className="w-full sm:w-auto">
              {saving ? "กำลังบันทึก..." : planId ? "บันทึก" : "สร้างแผน"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
