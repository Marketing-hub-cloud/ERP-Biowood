"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/form-field";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { companySchema } from "@/lib/validators";
import { cn } from "@/lib/utils";

type Values = {
  nameTh: string;
  nameEn: string;
  address: string;
  taxId: string;
  branch: string;
  phone: string;
  email: string;
  website: string;
};

export function CompanyForm({ initial, logoUrl, canEdit }: { initial: Values; logoUrl: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const disabled = !canEdit || saving;
  const set = (k: keyof Values, val: string) => setV((s) => ({ ...s, [k]: val }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = companySchema.safeParse(v);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      return setErrors(fe);
    }
    setErrors({});
    setSaving(true);
    try {
      await api("/api/settings/company", { method: "PUT", body: v });
      toast.success("บันทึกข้อมูลบริษัทเรียบร้อย");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      await api("/api/settings/company/logo", { method: "POST", body: fd });
      toast.success("อัปโหลดโลโก้เรียบร้อย");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    try {
      await api("/api/settings/company/logo", { method: "DELETE" });
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <form onSubmit={onSubmit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ข้อมูลบริษัท (ใช้ในหัวเอกสารที่พิมพ์)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="ชื่อบริษัท (ไทย)" htmlFor="nameTh" required error={errors.nameTh}>
              <Input id="nameTh" value={v.nameTh} onChange={(e) => set("nameTh", e.target.value)} disabled={disabled} />
            </FormField>
            <FormField label="ชื่อบริษัท (อังกฤษ)" htmlFor="nameEn" error={errors.nameEn}>
              <Input id="nameEn" value={v.nameEn} onChange={(e) => set("nameEn", e.target.value)} disabled={disabled} />
            </FormField>
            <FormField label="ที่อยู่" htmlFor="address" error={errors.address} className="sm:col-span-2">
              <Textarea id="address" rows={3} value={v.address} onChange={(e) => set("address", e.target.value)} disabled={disabled} />
            </FormField>
            <FormField label="เลขประจำตัวผู้เสียภาษี" htmlFor="taxId" error={errors.taxId} hint="ตัวเลข 13 หลัก">
              <Input id="taxId" inputMode="numeric" maxLength={13} value={v.taxId} onChange={(e) => set("taxId", e.target.value.replace(/\D/g, ""))} disabled={disabled} />
            </FormField>
            <FormField label="สาขา" htmlFor="branch" error={errors.branch} hint="เช่น สำนักงานใหญ่">
              <Input id="branch" value={v.branch} onChange={(e) => set("branch", e.target.value)} disabled={disabled} />
            </FormField>
            <FormField label="เบอร์โทร" htmlFor="phone" error={errors.phone}>
              <Input id="phone" value={v.phone} onChange={(e) => set("phone", e.target.value)} disabled={disabled} />
            </FormField>
            <FormField label="อีเมล" htmlFor="companyEmail" error={errors.email}>
              <Input id="companyEmail" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} disabled={disabled} />
            </FormField>
            <FormField label="เว็บไซต์" htmlFor="website" error={errors.website} className="sm:col-span-2">
              <Input id="website" value={v.website} onChange={(e) => set("website", e.target.value)} disabled={disabled} />
            </FormField>
          </CardContent>
          {canEdit && (
            <div className="flex justify-end px-6 pb-6">
              <Button type="submit" disabled={saving}>
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </Button>
            </div>
          )}
        </Card>
      </form>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">โลโก้</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            className={cn(
              "flex aspect-[4/3] items-center justify-center rounded-lg border-2 border-dashed bg-muted/40 p-3 text-center text-sm text-muted-foreground",
              dragOver && "border-primary bg-primary/5",
              canEdit && "cursor-pointer",
            )}
            onClick={() => canEdit && fileRef.current?.click()}
            onDragOver={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (canEdit && f) upload(f);
            }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="โลโก้บริษัท" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-2">
                <ImageUp className="size-8" />
                {canEdit ? "ลากไฟล์มาวาง หรือคลิกเพื่อเลือก" : "ยังไม่มีโลโก้"}
              </span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          {uploading && <p className="text-sm text-muted-foreground">กำลังอัปโหลด...</p>}
          {canEdit && logoUrl && (
            <Button variant="outline" size="sm" className="w-full" onClick={removeLogo}>
              <Trash2 /> ลบโลโก้
            </Button>
          )}
          <p className="text-xs text-muted-foreground">PNG, JPG, WEBP ไม่เกิน 5MB</p>
        </CardContent>
      </Card>
    </div>
  );
}
