"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/form-field";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { userCreateSchema, userUpdateSchema } from "@/lib/validators";

export type UserFormValues = {
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  position: string;
  isAdmin: boolean;
  groupIds: string[];
};

type Props = {
  mode: "create" | "edit";
  userId?: string;
  initial?: UserFormValues;
  groups: { id: string; name: string }[];
  canEdit: boolean;
  /** ผู้ใช้ปัจจุบันเป็น admin หรือไม่ (เฉพาะ admin กำหนดสิทธิ์ admin ได้) */
  actorIsAdmin: boolean;
};

const EMPTY: UserFormValues = { email: "", firstName: "", lastName: "", department: "", position: "", isAdmin: false, groupIds: [] };

export function UserForm({ mode, userId, initial = EMPTY, groups, canEdit, actorIsAdmin }: Props) {
  const router = useRouter();
  const [v, setV] = useState<UserFormValues>(initial);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const disabled = !canEdit || saving;

  const set = <K extends keyof UserFormValues>(k: K, val: UserFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...v, password, confirmPassword };
    const schema = mode === "create" ? userCreateSchema : userUpdateSchema;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (mode === "create") {
        const res = await api<{ id: string }>("/api/users", { method: "POST", body });
        toast.success("สร้างผู้ใช้เรียบร้อย");
        router.push(`/users/accounts/${res.id}`);
      } else {
        await api(`/api/users/${userId}`, { method: "PATCH", body });
        toast.success("บันทึกเรียบร้อย");
        setPassword("");
        setConfirmPassword("");
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ข้อมูลผู้ใช้</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="อีเมล" htmlFor="email" required error={errors.email} className="sm:col-span-2">
            <Input id="email" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} disabled={disabled} autoComplete="off" />
          </FormField>
          <FormField label="ชื่อ" htmlFor="firstName" required error={errors.firstName}>
            <Input id="firstName" value={v.firstName} onChange={(e) => set("firstName", e.target.value)} disabled={disabled} />
          </FormField>
          <FormField label="นามสกุล" htmlFor="lastName" required error={errors.lastName}>
            <Input id="lastName" value={v.lastName} onChange={(e) => set("lastName", e.target.value)} disabled={disabled} />
          </FormField>
          <FormField label="แผนก" htmlFor="department" error={errors.department}>
            <Input id="department" value={v.department} onChange={(e) => set("department", e.target.value)} disabled={disabled} />
          </FormField>
          <FormField label="ตำแหน่ง" htmlFor="position" error={errors.position}>
            <Input id="position" value={v.position} onChange={(e) => set("position", e.target.value)} disabled={disabled} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">รหัสผ่าน</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="รหัสผ่าน"
            htmlFor="password"
            required={mode === "create"}
            error={errors.password}
            hint={mode === "edit" ? "เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน" : "อย่างน้อย 8 ตัวอักษร"}
          >
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={disabled} autoComplete="new-password" />
          </FormField>
          <FormField label="ยืนยันรหัสผ่าน" htmlFor="confirmPassword" required={mode === "create"} error={errors.confirmPassword}>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={disabled}
              autoComplete="new-password"
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">กลุ่มสิทธิ์</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {actorIsAdmin && (
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Switch id="isAdmin" checked={v.isAdmin} onCheckedChange={(c) => set("isAdmin", c)} disabled={disabled} />
              <div>
                <Label htmlFor="isAdmin">ผู้ดูแลระบบ (admin)</Label>
                <p className="text-xs text-muted-foreground">มีสิทธิ์ทุกเมนูโดยไม่ต้องอยู่ในกลุ่มสิทธิ์</p>
              </div>
            </div>
          )}
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีกลุ่มสิทธิ์</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={v.groupIds.includes(g.id)}
                    disabled={disabled}
                    onCheckedChange={(c) => set("groupIds", c ? [...v.groupIds, g.id] : v.groupIds.filter((x) => x !== g.id))}
                  />
                  {g.name}
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/users/accounts")} disabled={saving}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </div>
      )}
    </form>
  );
}
