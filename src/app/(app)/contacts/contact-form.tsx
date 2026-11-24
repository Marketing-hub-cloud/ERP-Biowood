"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ImageUp, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { LookupSelect } from "@/components/lookup-select";
import { TagPicker } from "@/components/tag-picker";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { CHANNEL_LABELS, CHANNEL_TYPES, contactSchema } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { AddressFields, EMPTY_ADDRESS, type AddressValues } from "./address-fields";

type ChannelType = (typeof CHANNEL_TYPES)[number];
type ShipAddress = AddressValues & { _k: string; label: string; recipient: string; phone: string; isDefault: boolean };
type Channel = { _k: string; type: ChannelType; value: string; note: string };
type Person = { _k: string; name: string; position: string; phone: string; email: string; lineId: string; note: string; isPrimary: boolean };

export type ContactFormValues = {
  code: string;
  isCustomer: boolean;
  isVendor: boolean;
  entityType: "JURISTIC" | "INDIVIDUAL";
  name: string;
  taxId: string;
  branch: string;
  sourceId: string | null;
  customerBusinessTypeId: string | null;
  note: string;
  reg: AddressValues;
  shippingAddresses: ShipAddress[];
  channels: Channel[];
  persons: Person[];
  tagIds: string[];
};

type Option = { id: string; label: string };
type Props = {
  mode: "create" | "edit";
  contactId?: string;
  initial: ContactFormValues;
  options: { sources: Option[]; businessTypes: Option[]; tags: { id: string; name: string }[] };
  canEdit: boolean;
  canDelete?: boolean;
  /** บทบาทที่ผู้ใช้ติ๊ก/เอาออกได้ */
  roleEditable: { customer: boolean; vendor: boolean };
  canAddOptions: boolean;
  backHref: string;
  /** URL รูปที่บันทึกแล้ว (โหมดแก้ไข) */
  photoUrl?: string | null;
};

let keySeq = 0;
export const newKey = () => `k${++keySeq}${Date.now().toString(36)}`;

export const emptyShip = (): ShipAddress => ({ ...EMPTY_ADDRESS, _k: newKey(), label: "", recipient: "", phone: "", isDefault: false });
export const emptyChannel = (type: ChannelType = "PHONE"): Channel => ({ _k: newKey(), type, value: "", note: "" });
export const emptyPerson = (): Person => ({ _k: newKey(), name: "", position: "", phone: "", email: "", lineId: "", note: "", isPrimary: false });

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-2">
      <CardTitle className="text-base">{title}</CardTitle>
      {action}
    </CardHeader>
  );
}

export function ContactForm({ mode, contactId, initial, options, canEdit, canDelete, roleEditable, canAddOptions, backHref, photoUrl }: Props) {
  const router = useRouter();
  const [v, setV] = useState<ContactFormValues>(initial);
  const [sources, setSources] = useState(options.sources);
  const [businessTypes, setBusinessTypes] = useState(options.businessTypes);
  const [tags, setTags] = useState(options.tags);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const disabled = !canEdit || saving;

  const set = <K extends keyof ContactFormValues>(k: K, val: ContactFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const updateAt = <K extends "shippingAddresses" | "channels" | "persons">(k: K, i: number, patch: Partial<ContactFormValues[K][number]>) =>
    setV((s) => ({ ...s, [k]: s[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const removeAt = (k: "shippingAddresses" | "channels" | "persons", i: number) => setV((s) => ({ ...s, [k]: s[k].filter((_, j) => j !== i) }));
  const err = (k: string) => errors[k];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = contactSchema.safeParse(v);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      toast.error("กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (mode === "create") {
        const res = await api<{ id: string; code: string }>("/api/contacts", { method: "POST", body: v });
        if (photo) {
          const fd = new FormData();
          fd.append("file", photo);
          await api(`/api/contacts/${res.id}/photo`, { method: "POST", body: fd }).catch((err) => toast.error(`บันทึกแล้ว แต่อัปโหลดรูปไม่สำเร็จ: ${errorMessage(err)}`));
        }
        toast.success(`สร้างผู้ติดต่อ ${res.code} เรียบร้อย`);
        router.push(`/contacts/${res.id}`);
      } else {
        await api(`/api/contacts/${contactId}`, { method: "PATCH", body: v });
        toast.success("บันทึกเรียบร้อย");
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    setSaving(true);
    try {
      await api(`/api/contacts/${contactId}`, { method: "DELETE" });
      toast.success("ลบผู้ติดต่อเรียบร้อย");
      router.push(backHref);
    } catch (err) {
      toast.error(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {/* ───── ข้อมูลกิจการ ───── */}
      <Card>
        <SectionHeader title="ข้อมูลกิจการ" />
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>
              ประเภทผู้ติดต่อ<span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-3">
              {(
                [
                  ["isCustomer", "customer", "ลูกค้า"],
                  ["isVendor", "vendor", "ผู้ขาย"],
                ] as const
              ).map(([field, role, label]) => (
                <label key={field} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", v[field] && "border-primary bg-primary/5")}>
                  <Checkbox
                    id={field}
                    checked={v[field]}
                    disabled={disabled || !roleEditable[role]}
                    onCheckedChange={(c) => set(field, Boolean(c))}
                  />
                  {label}
                </label>
              ))}
            </div>
            {err("isCustomer") && <p className="text-xs text-destructive">{err("isCustomer")}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="รหัส" htmlFor="code" error={err("code")} hint={mode === "create" ? "เว้นว่างเพื่อสร้างอัตโนมัติ (CT00001)" : undefined}>
              <Input id="code" value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase())} disabled={disabled} placeholder={mode === "create" ? "อัตโนมัติ" : ""} />
            </FormField>
            <FormField label="ประเภทกิจการ" htmlFor="entityType" required>
              <Select value={v.entityType} onValueChange={(x) => set("entityType", x as ContactFormValues["entityType"])} disabled={disabled}>
                <SelectTrigger id="entityType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="JURISTIC">นิติบุคคล</SelectItem>
                  <SelectItem value="INDIVIDUAL">บุคคลธรรมดา</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="ช่องทางที่รู้จัก" htmlFor="sourceId" error={err("sourceId")}>
              <LookupSelect
                id="sourceId"
                kind="CONTACT_SOURCE"
                value={v.sourceId}
                onChange={(x) => set("sourceId", x)}
                options={sources}
                onOptionAdded={(o) => setSources((s) => [...s, o])}
                disabled={disabled}
                canAdd={canAddOptions}
              />
            </FormField>
            <FormField label={v.entityType === "JURISTIC" ? "ชื่อบริษัท/กิจการ" : "ชื่อ-นามสกุล"} htmlFor="name" required error={err("name")} className="sm:col-span-2">
              <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} disabled={disabled} />
            </FormField>
            <div className="row-span-3 hidden lg:block">
              <PhotoBox mode={mode} contactId={contactId} canEdit={canEdit} pending={photo} onPick={setPhoto} inputRef={photoRef} savedUrl={photoUrl ?? null} />
            </div>
            <FormField label="เลขประจำตัวผู้เสียภาษี" htmlFor="taxId" error={err("taxId")} hint="ตัวเลข 13 หลัก">
              <Input id="taxId" inputMode="numeric" maxLength={13} value={v.taxId} onChange={(e) => set("taxId", e.target.value.replace(/\D/g, ""))} disabled={disabled} />
            </FormField>
            <FormField label="สาขา" htmlFor="branch" error={err("branch")} hint="เช่น สำนักงานใหญ่ หรือ 00001">
              <Input id="branch" value={v.branch} onChange={(e) => set("branch", e.target.value)} disabled={disabled} />
            </FormField>
            <div className="lg:hidden sm:col-span-2">
              <PhotoBox mode={mode} contactId={contactId} canEdit={canEdit} pending={photo} onPick={setPhoto} inputRef={photoRef} savedUrl={photoUrl ?? null} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ───── ที่อยู่จดทะเบียน ───── */}
      <Card>
        <SectionHeader title="ที่อยู่จดทะเบียน" />
        <CardContent>
          <AddressFields prefix="reg" value={v.reg} onChange={(reg) => set("reg", reg)} disabled={disabled} errors={errors} />
        </CardContent>
      </Card>

      {/* ───── ที่อยู่จัดส่ง ───── */}
      <Card>
        <SectionHeader
          title={`ที่อยู่จัดส่ง (${v.shippingAddresses.length})`}
          action={
            !disabled && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set("shippingAddresses", [...v.shippingAddresses, { ...emptyShip(), ...v.reg, label: "ที่อยู่จดทะเบียน", isDefault: v.shippingAddresses.length === 0 }])}
                >
                  <Copy /> คัดลอกจากที่อยู่จดทะเบียน
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => set("shippingAddresses", [...v.shippingAddresses, { ...emptyShip(), isDefault: v.shippingAddresses.length === 0 }])}>
                  <Plus /> เพิ่มที่อยู่
                </Button>
              </div>
            )
          }
        />
        <CardContent className="space-y-4">
          {v.shippingAddresses.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีที่อยู่จัดส่ง</p>}
          {v.shippingAddresses.map((a, i) => (
            <div key={a._k} className="space-y-3 rounded-lg border p-3" data-testid="shipping-address">
              <div className="flex flex-wrap items-end gap-3">
                <FormField label="ชื่อที่อยู่" htmlFor={`ship-${i}-label`} className="min-w-40 flex-1">
                  <Input id={`ship-${i}-label`} value={a.label} placeholder="เช่น หน้างานบางนา" onChange={(e) => updateAt("shippingAddresses", i, { label: e.target.value })} disabled={disabled} />
                </FormField>
                <FormField label="ผู้รับ" htmlFor={`ship-${i}-recipient`} className="min-w-40 flex-1">
                  <Input id={`ship-${i}-recipient`} value={a.recipient} onChange={(e) => updateAt("shippingAddresses", i, { recipient: e.target.value })} disabled={disabled} />
                </FormField>
                <FormField label="เบอร์โทรผู้รับ" htmlFor={`ship-${i}-phone`} className="min-w-40 flex-1">
                  <Input id={`ship-${i}-phone`} value={a.phone} onChange={(e) => updateAt("shippingAddresses", i, { phone: e.target.value })} disabled={disabled} />
                </FormField>
                <div className="flex gap-1 pb-0.5">
                  <Button
                    type="button"
                    variant={a.isDefault ? "default" : "outline"}
                    size="sm"
                    disabled={disabled}
                    onClick={() => set("shippingAddresses", v.shippingAddresses.map((x, j) => ({ ...x, isDefault: j === i })))}
                  >
                    <Star /> {a.isDefault ? "ที่อยู่หลัก" : "ตั้งเป็นหลัก"}
                  </Button>
                  {!disabled && (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeAt("shippingAddresses", i)} aria-label="ลบที่อยู่จัดส่ง">
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
              <AddressFields
                prefix={`shippingAddresses.${i}`}
                value={a}
                onChange={(addr) => updateAt("shippingAddresses", i, addr)}
                disabled={disabled}
                errors={errors}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ───── ช่องทางติดต่อ ───── */}
      <Card>
        <SectionHeader
          title={`ช่องทางติดต่อ (${v.channels.length})`}
          action={
            !disabled && (
              <Button type="button" variant="outline" size="sm" onClick={() => set("channels", [...v.channels, emptyChannel(v.channels.length === 0 ? "PHONE" : "EMAIL")])}>
                <Plus /> เพิ่มช่องทาง
              </Button>
            )
          }
        />
        <CardContent className="space-y-2">
          {v.channels.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีช่องทางติดต่อ</p>}
          {v.channels.map((c, i) => (
            <div key={c._k} className="grid gap-2 sm:grid-cols-[160px_1fr_1fr_auto]" data-testid="channel-row">
              <Select value={c.type} onValueChange={(x) => updateAt("channels", i, { type: x as ChannelType })} disabled={disabled}>
                <SelectTrigger className="w-full" aria-label="ชนิดช่องทาง">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {CHANNEL_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div>
                <Input value={c.value} placeholder="เบอร์ / อีเมล / ID" aria-label="ข้อมูลช่องทาง" onChange={(e) => updateAt("channels", i, { value: e.target.value })} disabled={disabled} aria-invalid={Boolean(err(`channels.${i}.value`))} />
                {err(`channels.${i}.value`) && <p className="mt-1 text-xs text-destructive">{err(`channels.${i}.value`)}</p>}
              </div>
              <Input value={c.note} placeholder="หมายเหตุ" aria-label="หมายเหตุช่องทาง" onChange={(e) => updateAt("channels", i, { note: e.target.value })} disabled={disabled} />
              {!disabled ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => removeAt("channels", i)} aria-label="ลบช่องทาง">
                  <Trash2 />
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ───── บุคคลติดต่อ ───── */}
      <Card>
        <SectionHeader
          title={`บุคคลติดต่อ (${v.persons.length})`}
          action={
            !disabled && (
              <Button type="button" variant="outline" size="sm" onClick={() => set("persons", [...v.persons, { ...emptyPerson(), isPrimary: v.persons.length === 0 }])}>
                <Plus /> เพิ่มบุคคลติดต่อ
              </Button>
            )
          }
        />
        <CardContent className="space-y-3">
          {v.persons.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีบุคคลติดต่อ</p>}
          {v.persons.map((p, i) => (
            <div key={p._k} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="person-row">
              <FormField label="ชื่อ" htmlFor={`person-${i}-name`} required error={err(`persons.${i}.name`)}>
                <Input id={`person-${i}-name`} value={p.name} onChange={(e) => updateAt("persons", i, { name: e.target.value })} disabled={disabled} />
              </FormField>
              <FormField label="ตำแหน่ง" htmlFor={`person-${i}-position`}>
                <Input id={`person-${i}-position`} value={p.position} onChange={(e) => updateAt("persons", i, { position: e.target.value })} disabled={disabled} />
              </FormField>
              <FormField label="เบอร์โทร" htmlFor={`person-${i}-phone`}>
                <Input id={`person-${i}-phone`} value={p.phone} onChange={(e) => updateAt("persons", i, { phone: e.target.value })} disabled={disabled} />
              </FormField>
              <FormField label="อีเมล" htmlFor={`person-${i}-email`} error={err(`persons.${i}.email`)}>
                <Input id={`person-${i}-email`} type="email" value={p.email} onChange={(e) => updateAt("persons", i, { email: e.target.value })} disabled={disabled} />
              </FormField>
              <FormField label="LINE ID" htmlFor={`person-${i}-line`}>
                <Input id={`person-${i}-line`} value={p.lineId} onChange={(e) => updateAt("persons", i, { lineId: e.target.value })} disabled={disabled} />
              </FormField>
              <FormField label="หมายเหตุ" htmlFor={`person-${i}-note`} className="sm:col-span-2">
                <Input id={`person-${i}-note`} value={p.note} onChange={(e) => updateAt("persons", i, { note: e.target.value })} disabled={disabled} />
              </FormField>
              <div className="flex items-end gap-1">
                <Button
                  type="button"
                  variant={p.isPrimary ? "default" : "outline"}
                  size="sm"
                  disabled={disabled}
                  onClick={() => set("persons", v.persons.map((x, j) => ({ ...x, isPrimary: j === i })))}
                >
                  <Star /> {p.isPrimary ? "ผู้ติดต่อหลัก" : "ตั้งเป็นหลัก"}
                </Button>
                {!disabled && (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeAt("persons", i)} aria-label="ลบบุคคลติดต่อ">
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ───── การจัดกลุ่ม ───── */}
      <Card>
        <SectionHeader title="การจัดกลุ่ม" />
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="ประเภทกิจการของลูกค้า" htmlFor="customerBusinessTypeId" hint="ใช้ในงานถอดแบบ/ติดตั้ง" error={err("customerBusinessTypeId")}>
            <LookupSelect
              id="customerBusinessTypeId"
              kind="CUSTOMER_BUSINESS_TYPE"
              value={v.customerBusinessTypeId}
              onChange={(x) => set("customerBusinessTypeId", x)}
              options={businessTypes}
              onOptionAdded={(o) => setBusinessTypes((s) => [...s, o])}
              disabled={disabled}
              canAdd={canAddOptions}
            />
          </FormField>
          <FormField label="กลุ่ม (tag)">
            <TagPicker value={v.tagIds} onChange={(ids) => set("tagIds", ids)} tags={tags} onTagAdded={(t) => setTags((s) => [...s, t])} disabled={disabled} canAdd={canAddOptions} />
          </FormField>
          <FormField label="หมายเหตุ" htmlFor="note" className="sm:col-span-2" error={err("note")}>
            <Textarea id="note" rows={3} value={v.note} onChange={(e) => set("note", e.target.value)} disabled={disabled} />
          </FormField>
        </CardContent>
      </Card>

      {(canEdit || canDelete) && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {canDelete && mode === "edit" && (
            <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={saving} className="mr-auto">
              <Trash2 /> ลบผู้ติดต่อ
            </Button>
          )}
          {canEdit && (
            <>
              <Button type="button" variant="outline" onClick={() => router.push(backHref)} disabled={saving}>
                ยกเลิก
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </Button>
            </>
          )}
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบผู้ติดต่อ &quot;{v.name}&quot;?</DialogTitle>
            <DialogDescription>ผู้ติดต่อจะหายจากรายการ (ประวัติการเปลี่ยนแปลงยังเก็บไว้)</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              ยกเลิก
            </Button>
            <Button variant="destructive" onClick={onDelete} disabled={saving}>
              ยืนยันลบ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

/** รูปผู้ติดต่อ: ลากวาง/คลิกเลือก — โหมดสร้างจะอัปโหลดหลังบันทึก, โหมดแก้ไขอัปโหลดทันที */
function PhotoBox({
  mode,
  contactId,
  canEdit,
  pending,
  onPick,
  inputRef,
  savedUrl,
}: {
  mode: "create" | "edit";
  contactId?: string;
  canEdit: boolean;
  pending: File | null;
  onPick: (f: File | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  savedUrl: string | null;
}) {
  const router = useRouter();
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingUrl = usePendingPreview(pending);
  const photoUrl = mode === "create" ? pendingUrl : savedUrl;

  async function handle(f: File) {
    if (mode === "create") return onPick(f);
    const fd = new FormData();
    fd.append("file", f);
    setBusy(true);
    try {
      await api(`/api/contacts/${contactId}/photo`, { method: "POST", body: fd });
      toast.success("อัปโหลดรูปเรียบร้อย");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>รูปผู้ติดต่อ</Label>
      <div
        className={cn(
          "flex aspect-square max-h-48 w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed bg-muted/40 text-center text-xs text-muted-foreground",
          drag && "border-primary bg-primary/5",
          canEdit && "cursor-pointer",
        )}
        onClick={() => canEdit && inputRef.current?.click()}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (canEdit && f) handle(f);
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="รูปผู้ติดต่อ" className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 p-2">
            <ImageUp className="size-6" />
            {busy ? "กำลังอัปโหลด..." : canEdit ? "ลากรูปมาวาง หรือคลิก" : "ไม่มีรูป"}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** preview ของไฟล์ที่เลือกไว้ (ยังไม่อัปโหลด) */
function usePendingPreview(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}
