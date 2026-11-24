"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { ACTION_LABELS, MENU, PERMISSION_ACTIONS, type PermissionAction } from "@/lib/menu";
import { EMPTY_FLAGS, normalizeFlags, type PermissionFlags, type PermissionMap } from "@/lib/rbac";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";

type UserOption = { id: string; name: string; email: string; department: string | null; inactive: boolean };

type Props = {
  mode: "create" | "edit";
  groupId?: string;
  initial?: { name: string; description: string; permissions: PermissionMap; memberIds: string[] };
  users: UserOption[];
  canEdit: boolean;
  canDelete?: boolean;
};

export function GroupForm({ mode, groupId, initial, users, canEdit, canDelete }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [perms, setPerms] = useState<PermissionMap>(initial?.permissions ?? {});
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? []);
  const [userSearch, setUserSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = !canEdit || saving;

  const flagsOf = (key: string): PermissionFlags => perms[key] ?? EMPTY_FLAGS;

  function toggle(key: string, action: PermissionAction, value: boolean) {
    setPerms((p) => ({ ...p, [key]: normalizeFlags(key, { ...(p[key] ?? EMPTY_FLAGS), [action]: value }) }));
  }

  /** ติ๊กทั้งแถว (ทุกสิทธิ์ที่เมนูรองรับ) */
  function toggleRow(key: string, actions: PermissionAction[], value: boolean) {
    setPerms((p) => ({ ...p, [key]: normalizeFlags(key, Object.fromEntries(actions.map((a) => [a, value]))) }));
  }

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return q ? users.filter((u) => `${u.name} ${u.email} ${u.department ?? ""}`.toLowerCase().includes(q)) : users;
  }, [users, userSearch]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: "กรุณากรอกชื่อกลุ่มสิทธิ์" });
      return;
    }
    setErrors({});
    setSaving(true);
    const body = { name, description, permissions: perms, memberIds };
    try {
      if (mode === "create") {
        const res = await api<{ id: string }>("/api/permission-groups", { method: "POST", body });
        toast.success("สร้างกลุ่มสิทธิ์เรียบร้อย");
        router.push(`/users/groups/${res.id}`);
      } else {
        await api(`/api/permission-groups/${groupId}`, { method: "PATCH", body });
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
      await api(`/api/permission-groups/${groupId}`, { method: "DELETE" });
      toast.success("ลบกลุ่มสิทธิ์เรียบร้อย");
      router.push("/users/groups");
    } catch (err) {
      toast.error(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ข้อมูลกลุ่มสิทธิ์</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label="ชื่อกลุ่มสิทธิ์" htmlFor="name" required error={errors.name}>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} />
          </FormField>
          <FormField label="คำอธิบาย" htmlFor="description" error={errors.description}>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={disabled} rows={1} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">สิทธิ์การใช้งานแต่ละเมนู</CardTitle>
          <p className="text-xs text-muted-foreground">ถ้าไม่ติ๊ก &quot;ดู&quot; สิทธิ์อื่นของเมนูนั้นจะปิดทั้งหมด และเมนูจะไม่แสดงใน sidebar</p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48 pl-6">เมนู</TableHead>
                <TableHead className="w-16 text-center">ทั้งหมด</TableHead>
                {PERMISSION_ACTIONS.map((a) => (
                  <TableHead key={a} className="w-16 text-center">
                    {ACTION_LABELS[a]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {MENU.map((section) => {
                const items = section.items.filter((i) => !i.public);
                if (!items.length) return null;
                return [
                  <TableRow key={section.key} className="bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={2 + PERMISSION_ACTIONS.length} className="pl-6 font-semibold">
                      {section.label}
                    </TableCell>
                  </TableRow>,
                  ...items.map((item) => {
                    const f = flagsOf(item.key);
                    const all = item.actions.every((a) => f[a]);
                    return (
                      <TableRow key={item.key} data-menu-key={item.key}>
                        <TableCell className="pl-10">{item.label}</TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={all}
                            disabled={disabled}
                            onCheckedChange={(c) => toggleRow(item.key, item.actions, Boolean(c))}
                            aria-label={`${item.label} ทั้งหมด`}
                          />
                        </TableCell>
                        {PERMISSION_ACTIONS.map((a) => {
                          const supported = item.actions.includes(a);
                          if (!supported) return <TableCell key={a} className="text-center text-muted-foreground/40">—</TableCell>;
                          return (
                            <TableCell key={a} className="text-center">
                              <Checkbox
                                checked={f[a]}
                                disabled={disabled || (a !== "view" && !f.view)}
                                onCheckedChange={(c) => toggle(item.key, a, Boolean(c))}
                                aria-label={`${item.label} ${ACTION_LABELS[a]}`}
                                data-action={a}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  }),
                ];
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">พนักงานในกลุ่ม ({memberIds.length} คน)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="ค้นหาพนักงาน..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
          </div>
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {filteredUsers.map((u) => (
              <label key={u.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={memberIds.includes(u.id)}
                  disabled={disabled}
                  onCheckedChange={(c) => setMemberIds((m) => (c ? [...m, u.id] : m.filter((x) => x !== u.id)))}
                />
                <span>
                  <span className="block font-medium">
                    {u.name} {u.inactive && <span className="text-xs text-destructive">(หยุดใช้งาน)</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">{u.email}</span>
                </span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {(canEdit || canDelete) && (
        <div className="flex flex-wrap justify-end gap-2">
          {canDelete && mode === "edit" && (
            <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={saving} className="mr-auto">
              <Trash2 /> ลบกลุ่มสิทธิ์
            </Button>
          )}
          {canEdit && (
            <>
              <Button type="button" variant="outline" onClick={() => router.push("/users/groups")} disabled={saving}>
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
            <DialogTitle>ลบกลุ่มสิทธิ์ &quot;{name}&quot;?</DialogTitle>
            <DialogDescription>สมาชิกในกลุ่มจะเสียสิทธิ์ที่ได้จากกลุ่มนี้ทันที</DialogDescription>
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
