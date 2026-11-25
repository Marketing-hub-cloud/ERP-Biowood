"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { DateField } from "@/components/date-field";
import { SearchSelect } from "@/components/search-select";
import { LookupSelect } from "@/components/lookup-select";
import { TagPicker } from "@/components/tag-picker";
import { ContactPicker } from "@/components/contact-picker";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { projectSchema } from "@/lib/validators";
import { PROBABILITY_OPTIONS, PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ProjectStatus } from "@/lib/crm";
import type { ProjectFormOptions } from "@/server/projects";
import type { ContactOption } from "@/app/api/contact-options/route";
import type { ContactPersonOption } from "@/app/api/contact-options/[id]/persons/route";

export type ProjectValues = {
  name: string;
  status: ProjectStatus;
  customer: ContactOption | null;
  contactPerson: string;
  salesRepId: string;
  businessTypeId: string | null;
  workStageId: string | null;
  workNatureId: string | null;
  workDetail: string;
  probability: string;
  expectedCloseDate: string;
  value: string;
  tagIds: string[];
  warrantyStart: string;
  warrantyEnd: string;
  warrantyNote: string;
  note: string;
};

const NONE = "__none__";

const payload = (v: ProjectValues) => ({
  name: v.name,
  status: v.status,
  customerId: v.customer?.id ?? "",
  contactPerson: v.contactPerson,
  salesRepId: v.salesRepId || null,
  businessTypeId: v.businessTypeId,
  workStageId: v.workStageId,
  workNatureId: v.workNatureId,
  workDetail: v.workDetail,
  probability: v.probability || null,
  expectedCloseDate: v.expectedCloseDate || null,
  value: v.value,
  tagIds: v.tagIds,
  warrantyStart: v.warrantyStart || null,
  warrantyEnd: v.warrantyEnd || null,
  warrantyNote: v.warrantyNote,
  note: v.note,
});

export function ProjectForm({
  projectId,
  initial,
  options,
  canEdit,
  canDelete,
}: {
  projectId: string | null;
  initial: ProjectValues;
  options: ProjectFormOptions;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [persons, setPersons] = useState<ContactPersonOption[]>([]);
  const [businessTypes, setBusinessTypes] = useState(options.businessTypes);
  const [workStages, setWorkStages] = useState(options.workStages);
  const [workNatures, setWorkNatures] = useState(options.workNatures);
  const [tags, setTags] = useState(options.tags);
  const editable = canEdit && !saving;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof ProjectValues>(k: K, val: ProjectValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const err = (k: string) => errors[k];

  const customerId = v.customer?.id;
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    fetch(`/api/contact-options/${customerId}/persons`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: ContactPersonOption[]) => !cancelled && setPersons(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const active = <T extends { id: string; isActive: boolean }>(xs: T[], cur: string | null) => xs.filter((x) => x.isActive || x.id === cur);
  const users = options.users.filter((u) => !u.inactive || u.id === v.salesRepId).map((u) => ({ value: u.id, label: u.name, hint: u.department ?? undefined }));

  async function save() {
    const body = payload(v);
    const parsed = projectSchema.safeParse(body);
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
      if (!projectId) {
        const res = await api<{ id: string }>("/api/crm/projects", { method: "POST", body });
        toast.success("สร้างโครงการแล้ว");
        router.push(`/crm/projects/${res.id}`);
      } else {
        await api(`/api/crm/projects/${projectId}`, { method: "PATCH", body });
        toast.success(v.status !== initial.status ? `เปลี่ยนสถานะเป็น "${PROJECT_STATUS_LABELS[v.status]}" แล้ว` : "บันทึกเรียบร้อย");
        router.refresh();
      }
    } catch (e) {
      if (e instanceof ApiClientError) setErrors(e.fields);
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await api(`/api/crm/projects/${projectId}`, { method: "DELETE" });
      toast.success("ลบโครงการแล้ว");
      router.push("/crm/projects");
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  const lookup = (
    id: "businessTypeId" | "workStageId" | "workNatureId",
    kind: "CUSTOMER_BUSINESS_TYPE" | "PROJECT_WORK_STAGE" | "PROJECT_WORK_NATURE",
    list: { id: string; label: string; isActive: boolean }[],
    setList: (f: (s: { id: string; label: string; isActive: boolean }[]) => { id: string; label: string; isActive: boolean }[]) => void,
  ) => (
    <LookupSelect
      id={id}
      kind={kind}
      value={v[id]}
      onChange={(x) => set(id, x)}
      options={active(list, v[id])}
      onOptionAdded={(o) => setList((s) => [...s, { ...o, isActive: true }])}
      disabled={!editable}
      canAdd={canEdit}
    />
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="ชื่อโครงการ" htmlFor="name" required error={err("name")} className="sm:col-span-2">
            <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="สถานะ" htmlFor="status" error={err("status")}>
            <Select value={v.status} onValueChange={(x) => set("status", x as ProjectStatus)} disabled={!editable}>
              <SelectTrigger id="status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="พนักงานขายผู้รับผิดชอบ" htmlFor="salesRepId" error={err("salesRepId")}>
            <SearchSelect id="salesRepId" value={v.salesRepId || null} onChange={(x) => set("salesRepId", x)} options={users} placeholder="- เลือกพนักงานขาย -" disabled={!editable} />
          </FormField>
          <FormField label="ลูกค้า" htmlFor="customerId" required error={err("customerId")} className="sm:col-span-2">
            <ContactPicker
              id="customerId"
              role="customer"
              value={v.customer}
              onChange={(c) => {
                setPersons([]);
                setV((s) => ({ ...s, customer: c, contactPerson: c?.id === s.customer?.id ? s.contactPerson : "" }));
              }}
              disabled={!editable}
              invalid={Boolean(err("customerId"))}
            />
          </FormField>
          <FormField label="บุคคลติดต่อ" htmlFor="contactPerson" error={err("contactPerson")} className="sm:col-span-2">
            <div className="flex gap-1">
              {editable && persons.length > 0 && (
                <Select
                  value={NONE}
                  onValueChange={(id) => {
                    const p = persons.find((x) => x.id === id);
                    if (p) set("contactPerson", [p.name, p.position && `(${p.position})`, p.phone && `โทร ${p.phone}`].filter(Boolean).join(" "));
                  }}
                >
                  <SelectTrigger className="w-40 shrink-0" aria-label="เลือกบุคคลติดต่อ">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>- เลือก -</SelectItem>
                    {persons.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.isPrimary ? " (หลัก)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input id="contactPerson" value={v.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} disabled={!editable} placeholder="ชื่อ / ตำแหน่ง / เบอร์" />
            </div>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">รายละเอียด</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="ประเภทกิจการ" htmlFor="businessTypeId" error={err("businessTypeId")}>
            {lookup("businessTypeId", "CUSTOMER_BUSINESS_TYPE", businessTypes, setBusinessTypes)}
          </FormField>
          <FormField label="ขั้นตอนของงาน" htmlFor="workStageId" error={err("workStageId")}>
            {lookup("workStageId", "PROJECT_WORK_STAGE", workStages, setWorkStages)}
          </FormField>
          <FormField label="ลักษณะงาน" htmlFor="workNatureId" error={err("workNatureId")}>
            {lookup("workNatureId", "PROJECT_WORK_NATURE", workNatures, setWorkNatures)}
          </FormField>
          <FormField label="% โอกาสสำเร็จ" htmlFor="probability" error={err("probability")}>
            <Select value={v.probability || NONE} onValueChange={(x) => set("probability", x === NONE ? "" : x)} disabled={!editable}>
              <SelectTrigger id="probability" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>- ไม่ระบุ -</SelectItem>
                {PROBABILITY_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="ข้อมูลลักษณะงาน" htmlFor="workDetail" error={err("workDetail")} className="sm:col-span-2">
            <Textarea id="workDetail" rows={2} value={v.workDetail} onChange={(e) => set("workDetail", e.target.value)} disabled={!editable} placeholder="เช่น รุ่นสินค้าที่ใช้" />
          </FormField>
          <FormField label="วันคาดการณ์ปิดดีล" htmlFor="expectedCloseDate" error={err("expectedCloseDate")}>
            <DateField id="expectedCloseDate" value={v.expectedCloseDate} onChange={(x) => set("expectedCloseDate", x)} disabled={!editable} />
          </FormField>
          <FormField label="มูลค่า (บาท)" htmlFor="value" error={err("value")}>
            <Input id="value" inputMode="decimal" className="text-right" value={v.value} onChange={(e) => set("value", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="กลุ่ม" error={err("tagIds")} className="sm:col-span-2 lg:col-span-4">
            <TagPicker value={v.tagIds} onChange={(ids) => set("tagIds", ids)} tags={tags} onTagAdded={(t) => setTags((s) => [...s, t])} disabled={!editable} canAdd={canEdit} />
          </FormField>
          <FormField label="หมายเหตุ" htmlFor="note" error={err("note")} className="sm:col-span-2 lg:col-span-4">
            <Textarea id="note" rows={2} value={v.note} onChange={(e) => set("note", e.target.value)} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ข้อมูลการรับประกัน</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="วันเริ่ม" htmlFor="warrantyStart" error={err("warrantyStart")}>
            <DateField id="warrantyStart" value={v.warrantyStart} onChange={(x) => set("warrantyStart", x)} disabled={!editable} />
          </FormField>
          <FormField label="วันสิ้นสุด" htmlFor="warrantyEnd" error={err("warrantyEnd")}>
            <DateField id="warrantyEnd" value={v.warrantyEnd} onChange={(x) => set("warrantyEnd", x)} disabled={!editable} />
          </FormField>
          <FormField label="หมายเหตุ" htmlFor="warrantyNote" error={err("warrantyNote")} className="sm:col-span-2">
            <Input id="warrantyNote" value={v.warrantyNote} onChange={(e) => set("warrantyNote", e.target.value)} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      {(canEdit || (canDelete && projectId)) && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {canDelete && projectId && (
            <Button type="button" variant="outline" className="mr-auto text-destructive" onClick={() => setConfirmDelete(true)} disabled={saving}>
              ลบโครงการ
            </Button>
          )}
          {canEdit && (
            <Button type="button" onClick={() => void save()} disabled={saving || (!!projectId && !dirty)}>
              {saving ? "กำลังบันทึก..." : "บันทึก"}
            </Button>
          )}
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบโครงการ</DialogTitle>
            <DialogDescription>ลบ &quot;{initial.name}&quot; ? (ประวัติการเคลื่อนไหวยังเก็บไว้)</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={saving}>
              ปิด
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={saving}>
              ยืนยันลบ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
