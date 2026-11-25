"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { DocNumberField } from "@/components/doc-number-field";
import { DateField } from "@/components/date-field";
import { SearchSelect } from "@/components/search-select";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { engineerDocSchema } from "@/lib/validators";
import {
  ENGINEER_STATUS_LABELS,
  isEditableStatus,
  showEstimate,
  stepIndex,
  URGENCY_LABELS,
  WORK_TYPE_LABELS,
  WORK_TYPES,
  type EngineerStatus,
  type EngineerUrgency,
  type EngineerWorkType,
} from "@/lib/engineer-workflow";
import type { EngineerFormOptions } from "@/server/engineer-docs";
import type { ContactOption } from "@/app/api/contact-options/route";
import { ProjectPicker, type PickedProject } from "@/components/project-picker";
import { CustomerBox, ParticipantPicker } from "./engineer-ui";

export type EstimateLineValues = { key: string; productId: string; quantity: string; note: string };
export type EngineerValues = {
  docDate: string;
  startDate: string;
  dueDate: string;
  revision: string;
  workTypes: EngineerWorkType[];
  workDetail: string;
  projectName: string;
  project: PickedProject | null;
  urgency: EngineerUrgency;
  customer: ContactOption | null;
  addressLabel: string;
  siteAddress: string;
  assigneeId: string;
  participantIds: string[];
  note: string;
  estimateLines: EstimateLineValues[];
};

let seq = 0;
const newLine = (): EstimateLineValues => ({ key: `n${++seq}`, productId: "", quantity: "", note: "" });

const payload = (v: EngineerValues) => ({
  docDate: v.docDate,
  startDate: v.startDate || null,
  dueDate: v.dueDate || null,
  revision: v.revision,
  workTypes: v.workTypes,
  workDetail: v.workDetail,
  projectName: v.projectName,
  projectId: v.project?.id ?? null,
  urgency: v.urgency,
  customerId: v.customer?.id ?? null,
  addressLabel: v.addressLabel,
  siteAddress: v.siteAddress,
  assigneeId: v.assigneeId || null,
  participantIds: v.participantIds,
  note: v.note,
  // แถวว่างทั้งแถว (ยังไม่เลือกสินค้าและไม่ได้กรอกจำนวน) ไม่ส่ง
  estimateLines: v.estimateLines.filter((l) => l.productId || l.quantity.trim()).map(({ productId, quantity, note }) => ({ productId, quantity, note })),
});

export type AdvanceInfo = { label: string; to: EngineerStatus; allowed: boolean; isApprove: boolean } | null;

export function EngineerForm({
  doc,
  initial,
  options,
  canEdit,
  canCancel,
  advance,
}: {
  doc: { id: string; docNo: string; status: EngineerStatus; createdAt: string } | null;
  initial: EngineerValues;
  options: EngineerFormOptions;
  canEdit: boolean;
  canCancel: boolean;
  advance: AdvanceInfo;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"advance" | "cancel" | null>(null);
  const [comment, setComment] = useState("");
  const [dialogError, setDialogError] = useState<string>();

  const status = doc?.status ?? "DRAFT";
  const editable = canEdit && isEditableStatus(status) && !saving && !busy;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof EngineerValues>(k: K, val: EngineerValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const setLine = (key: string, patch: Partial<EstimateLineValues>) =>
    setV((s) => ({ ...s, estimateLines: s.estimateLines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const err = (k: string) => errors[k];

  const productMap = useMemo(() => new Map(options.products.map((p) => [p.id, p])), [options.products]);
  const productOpts = options.products
    .filter((p) => p.isActive || v.estimateLines.some((l) => l.productId === p.id))
    .map((p) => ({ value: p.id, label: `${p.code} ${p.name}`, hint: p.unit }));
  const userOpts = options.users.filter((u) => !u.inactive || u.id === v.assigneeId).map((u) => ({ value: u.id, label: u.name, hint: u.department ?? undefined }));
  const estimateVisible = doc ? showEstimate(status) : false;
  const assigneeHighlight = doc && stepIndex(status) >= stepIndex("QUEUED");

  async function save(): Promise<boolean> {
    const body = payload(v);
    const parsed = engineerDocSchema.safeParse(body);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      toast.error(Object.values(fe)[0] ?? "กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง");
      return false;
    }
    setErrors({});
    setSaving(true);
    try {
      if (!doc) {
        const res = await api<{ id: string; docNo: string }>("/api/engineer/documents", { method: "POST", body });
        toast.success(`สร้างใบถอดแบบ/ติดตั้ง ${res.docNo} แล้ว`);
        router.push(`/engineer/documents/${res.id}`);
      } else {
        await api(`/api/engineer/documents/${doc.id}`, { method: "PATCH", body });
        toast.success("บันทึกเรียบร้อย");
        router.refresh();
      }
      return true;
    } catch (e) {
      if (e instanceof ApiClientError) setErrors(e.fields);
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action: "advance" | "cancel") {
    if (!doc) return;
    if (action === "cancel" && !comment.trim()) {
      setDialogError("กรุณากรอกเหตุผลการยกเลิก");
      return;
    }
    // ดำเนินการต่อ: บันทึกการแก้ไขก่อน
    if (action === "advance" && dirty && canEdit && !(await save())) {
      setDialog(null);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ status: EngineerStatus }>(`/api/engineer/documents/${doc.id}/actions`, {
        method: "POST",
        body: { action, from: status, comment: comment.trim() || null },
      });
      toast.success(action === "cancel" ? `${doc.docNo}: ยกเลิกเอกสารแล้ว` : `${doc.docNo}: ${ENGINEER_STATUS_LABELS[res.status]}`);
      setDialog(null);
      setComment("");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const showCancel = canCancel && doc && isEditableStatus(status);
  const showSave = canEdit && isEditableStatus(status);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="เลขที่เอกสาร" htmlFor="docNumber">
            <DocNumberField prefix="EN" value={doc?.docNo} />
          </FormField>
          <FormField label="วันที่สร้างเอกสาร" htmlFor="createdAt">
            <Input id="createdAt" value={doc ? formatDateTime(doc.createdAt) : "(อัตโนมัติ)"} disabled />
          </FormField>
          <FormField label="วันที่ออกเอกสาร" htmlFor="docDate" required error={err("docDate")}>
            <DateField id="docDate" value={v.docDate} onChange={(x) => set("docDate", x)} disabled={!editable} />
          </FormField>
          <FormField label="ครั้งที่" htmlFor="revision" error={err("revision")}>
            <Input id="revision" inputMode="numeric" value={v.revision} onChange={(e) => set("revision", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="วันที่เริ่มงาน" htmlFor="startDate" error={err("startDate")}>
            <DateField id="startDate" value={v.startDate} onChange={(x) => set("startDate", x)} disabled={!editable} />
          </FormField>
          <FormField label="วันที่กำหนดส่ง" htmlFor="dueDate" error={err("dueDate")}>
            <DateField id="dueDate" value={v.dueDate} onChange={(x) => set("dueDate", x)} disabled={!editable} />
          </FormField>
          <FormField label="ผู้เกี่ยวข้อง" error={err("participantIds")} className="sm:col-span-2">
            <ParticipantPicker value={v.participantIds} onChange={(ids) => set("participantIds", ids)} users={options.users} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ข้อมูลเบื้องต้น / ข้อมูลงาน</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="ประเภทงาน" required error={err("workTypes")} className="sm:col-span-2">
            <div className="flex flex-wrap gap-4 pt-1" role="group" aria-label="ประเภทงาน">
              {WORK_TYPES.map((w) => (
                <label key={w} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={v.workTypes.includes(w)}
                    onCheckedChange={(c) => set("workTypes", c ? WORK_TYPES.filter((x) => x === w || v.workTypes.includes(x)) : v.workTypes.filter((x) => x !== w))}
                    disabled={!editable}
                    aria-label={WORK_TYPE_LABELS[w]}
                  />
                  {WORK_TYPE_LABELS[w]}
                </label>
              ))}
            </div>
          </FormField>
          <FormField label="ความเร่งด่วน" htmlFor="urgency" error={err("urgency")}>
            <Select value={v.urgency} onValueChange={(x) => set("urgency", x as EngineerUrgency)} disabled={!editable}>
              <SelectTrigger id="urgency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(URGENCY_LABELS) as EngineerUrgency[]).map((u) => (
                  <SelectItem key={u} value={u}>
                    {URGENCY_LABELS[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="hidden lg:block" />
          <FormField label="ชื่อโครงการ" htmlFor="projectName" required error={err("projectName")} className="sm:col-span-2">
            <Input id="projectName" value={v.projectName} onChange={(e) => set("projectName", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="โครงการ CRM" htmlFor="projectId" error={err("projectId")} className="sm:col-span-2">
            <ProjectPicker
              id="projectId"
              value={v.project}
              customerId={v.customer?.id}
              onChange={(p) =>
                setV((s) => ({
                  ...s,
                  project: p,
                  projectName: p && !s.projectName.trim() ? p.name : s.projectName,
                  // เลือกโครงการ: ใช้ลูกค้าของโครงการถ้ายังไม่ได้เลือก
                  ...(p && !s.customer ? { customer: p.customer, addressLabel: "", siteAddress: "" } : {}),
                }))
              }
              disabled={!editable}
            />
          </FormField>
          <FormField label="ข้อมูลลักษณะงาน" htmlFor="workDetail" error={err("workDetail")} className="sm:col-span-2">
            <Textarea id="workDetail" rows={2} value={v.workDetail} onChange={(e) => set("workDetail", e.target.value)} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ลูกค้า / ผู้รับผิดชอบงาน</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="ลูกค้า" error={undefined} required={status !== "DRAFT"}>
            <CustomerBox
              value={{ contact: v.customer, addressLabel: v.addressLabel, siteAddress: v.siteAddress }}
              onChange={(c) => setV((s) => ({ ...s, customer: c.contact, addressLabel: c.addressLabel, siteAddress: c.siteAddress }))}
              disabled={!editable}
              error={err("customerId")}
            />
          </FormField>
          <FormField
            label="ผู้รับผิดชอบงาน"
            htmlFor="assigneeId"
            error={err("assigneeId")}
            required={Boolean(assigneeHighlight)}
            hint={!assigneeHighlight ? "เลือกก่อนอนุมัติขั้น \"มอบหมาย\"" : undefined}
          >
            <div className="flex gap-1">
              <SearchSelect id="assigneeId" value={v.assigneeId || null} onChange={(x) => set("assigneeId", x)} options={userOpts} placeholder="- เลือกผู้รับผิดชอบ -" disabled={!editable} className="flex-1" />
              {editable && v.assigneeId && (
                <Button type="button" variant="ghost" size="icon" onClick={() => set("assigneeId", "")} aria-label="ล้างผู้รับผิดชอบ">
                  <Trash2 />
                </Button>
              )}
            </div>
          </FormField>
          <FormField label="ที่อยู่หน้างาน" htmlFor="siteAddress" error={err("siteAddress")} className="sm:col-span-2">
            <Textarea id="siteAddress" rows={2} value={v.siteAddress} onChange={(e) => set("siteAddress", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="หมายเหตุ" htmlFor="note" error={err("note")} className="sm:col-span-2">
            <Textarea id="note" rows={2} value={v.note} onChange={(e) => set("note", e.target.value)} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      {estimateVisible && (
        <Card data-testid="estimate-card">
          <CardHeader>
            <CardTitle className="text-base">ใบสรุปประมาณถอดแบบ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {err("estimateLines") && <p className="text-sm text-destructive">{err("estimateLines")}</p>}
            {v.estimateLines.length === 0 && !editable && <p className="text-sm text-muted-foreground">ไม่มีรายการ</p>}
            {v.estimateLines.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead className="min-w-64">สินค้า</TableHead>
                      <TableHead className="w-36 text-right">จำนวน</TableHead>
                      <TableHead className="w-20">หน่วย</TableHead>
                      <TableHead className="min-w-40">หมายเหตุ</TableHead>
                      {editable && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v.estimateLines.map((l, i) => (
                      <TableRow key={l.key} data-testid="estimate-line">
                        <TableCell className="align-top text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="align-top">
                          <SearchSelect
                            id={`est-product-${i}`}
                            value={l.productId || null}
                            onChange={(x) => setLine(l.key, { productId: x })}
                            options={productOpts}
                            placeholder="- เลือกสินค้า -"
                            disabled={!editable}
                            aria-invalid={Boolean(err(`estimateLines.${i}.productId`))}
                          />
                          {err(`estimateLines.${i}.productId`) && <p className="mt-1 text-xs text-destructive">{err(`estimateLines.${i}.productId`)}</p>}
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            aria-label={`จำนวน รายการที่ ${i + 1}`}
                            inputMode="decimal"
                            className="text-right"
                            value={l.quantity}
                            onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                            disabled={!editable}
                            aria-invalid={Boolean(err(`estimateLines.${i}.quantity`))}
                          />
                          {err(`estimateLines.${i}.quantity`) && <p className="mt-1 text-xs text-destructive">{err(`estimateLines.${i}.quantity`)}</p>}
                        </TableCell>
                        <TableCell className="align-top pt-4 text-sm">{productMap.get(l.productId)?.unit}</TableCell>
                        <TableCell className="align-top">
                          <Input aria-label={`หมายเหตุ รายการที่ ${i + 1}`} value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} disabled={!editable} />
                        </TableCell>
                        {editable && (
                          <TableCell className="align-top">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`ลบรายการที่ ${i + 1}`}
                              onClick={() => setV((s) => ({ ...s, estimateLines: s.estimateLines.filter((x) => x.key !== l.key) }))}
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {editable && (
              <Button type="button" variant="outline" onClick={() => setV((s) => ({ ...s, estimateLines: [...s.estimateLines, newLine()] }))}>
                <Plus /> เพิ่มรายการ
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {(showCancel || showSave || advance) && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {showCancel && (
            <Button type="button" variant="outline" className="mr-auto text-destructive" onClick={() => setDialog("cancel")} disabled={saving || busy}>
              ยกเลิกเอกสาร
            </Button>
          )}
          {showSave && (
            <Button type="button" variant={doc ? "outline" : "default"} onClick={() => void save()} disabled={saving || busy || (!!doc && !dirty)}>
              {saving ? "กำลังบันทึก..." : doc ? "บันทึก" : "บันทึกร่าง"}
            </Button>
          )}
          {advance && (
            <Button
              type="button"
              onClick={() => setDialog("advance")}
              disabled={saving || busy || !advance.allowed}
              title={advance.allowed ? undefined : "ไม่มีสิทธิ์ทำขั้นนี้"}
              data-testid="advance-button"
            >
              {advance.isApprove ? <Check /> : <ArrowRight />} {advance.label}
            </Button>
          )}
        </div>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDialog(null);
            setDialogError(undefined);
          }
        }}
      >
        {dialog && doc && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {dialog === "cancel" ? "ยกเลิกเอกสาร" : advance?.label} {doc.docNo}
              </DialogTitle>
              <DialogDescription>
                {dialog === "cancel"
                  ? "ยกเลิกแล้วแก้ไขหรือนำกลับมาใช้ไม่ได้"
                  : `${ENGINEER_STATUS_LABELS[status]} → ${advance ? ENGINEER_STATUS_LABELS[advance.to] : ""}${dirty && canEdit ? " (จะบันทึกการแก้ไขก่อน)" : ""}`}
              </DialogDescription>
            </DialogHeader>
            <FormField label={dialog === "cancel" ? "เหตุผลการยกเลิก" : "ความเห็น (ไม่บังคับ)"} htmlFor="actionComment" required={dialog === "cancel"} error={dialogError}>
              <Textarea
                id="actionComment"
                rows={3}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  setDialogError(undefined);
                }}
              />
            </FormField>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialog(null)} disabled={busy || saving}>
                ปิด
              </Button>
              <Button variant={dialog === "cancel" ? "destructive" : "default"} onClick={() => void runAction(dialog)} disabled={busy || saving}>
                {busy || saving ? "กำลังดำเนินการ..." : dialog === "cancel" ? "ยืนยันยกเลิกเอกสาร" : `ยืนยัน${advance?.label ?? ""}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

export { newLine as newEstimateLine };
