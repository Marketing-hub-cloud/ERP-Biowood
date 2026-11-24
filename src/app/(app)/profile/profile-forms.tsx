"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/form-field";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { changePasswordSchema, profileSchema } from "@/lib/validators";

function zodErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fe: Record<string, string> = {};
  for (const i of issues) fe[i.path.join(".")] ??= i.message;
  return fe;
}

type ProfileValues = { firstName: string; lastName: string; department: string; position: string };

export function ProfileForm({ email, initial }: { email: string; initial: ProfileValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof ProfileValues, val: string) => setV((s) => ({ ...s, [k]: val }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = profileSchema.safeParse(v);
    if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
    setErrors({});
    setSaving(true);
    try {
      await api("/api/profile", { method: "PATCH", body: v });
      toast.success("บันทึกข้อมูลส่วนตัวเรียบร้อย");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle className="text-base">ข้อมูลส่วนตัว</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="อีเมล" className="sm:col-span-2" hint="เปลี่ยนอีเมลได้โดยผู้ดูแลระบบเท่านั้น">
            <Input value={email} disabled />
          </FormField>
          <FormField label="ชื่อ" htmlFor="firstName" required error={errors.firstName}>
            <Input id="firstName" value={v.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </FormField>
          <FormField label="นามสกุล" htmlFor="lastName" required error={errors.lastName}>
            <Input id="lastName" value={v.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </FormField>
          <FormField label="แผนก" htmlFor="department" error={errors.department}>
            <Input id="department" value={v.department} onChange={(e) => set("department", e.target.value)} />
          </FormField>
          <FormField label="ตำแหน่ง" htmlFor="position" error={errors.position}>
            <Input id="position" value={v.position} onChange={(e) => set("position", e.target.value)} />
          </FormField>
        </CardContent>
        <CardFooter className="justify-end pt-4">
          <Button type="submit" disabled={saving}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function PasswordForm() {
  const [v, setV] = useState({ currentPassword: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = changePasswordSchema.safeParse(v);
    if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
    setErrors({});
    setSaving(true);
    try {
      await api("/api/profile/password", { method: "POST", body: v });
      toast.success("เปลี่ยนรหัสผ่านเรียบร้อย");
      setV({ currentPassword: "", password: "", confirmPassword: "" });
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card id="password">
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle className="text-base">เปลี่ยนรหัสผ่าน</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <FormField label="รหัสผ่านปัจจุบัน" htmlFor="currentPassword" required error={errors.currentPassword}>
            <Input id="currentPassword" type="password" autoComplete="current-password" value={v.currentPassword} onChange={(e) => set("currentPassword", e.target.value)} />
          </FormField>
          <FormField label="รหัสผ่านใหม่" htmlFor="newPassword" required error={errors.password} hint="อย่างน้อย 8 ตัวอักษร">
            <Input id="newPassword" type="password" autoComplete="new-password" value={v.password} onChange={(e) => set("password", e.target.value)} />
          </FormField>
          <FormField label="ยืนยันรหัสผ่านใหม่" htmlFor="confirmNewPassword" required error={errors.confirmPassword}>
            <Input id="confirmNewPassword" type="password" autoComplete="new-password" value={v.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} />
          </FormField>
        </CardContent>
        <CardFooter className="justify-end pt-4">
          <Button type="submit" disabled={saving}>
            {saving ? "กำลังบันทึก..." : "เปลี่ยนรหัสผ่าน"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
