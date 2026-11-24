"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/form-field";
import { AuditHistory } from "@/components/audit-history";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { formatNumber } from "@/lib/format";
import { ATTRIBUTE_TYPE_LABELS } from "@/lib/validators";

type DataType = "TEXT" | "NUMBER" | "SELECT";
type Attr = { id: string; name: string; dataType: DataType; options: string[]; unitLabel: string | null; isRequired: boolean; isActive: boolean; sortOrder: number };
type Form = { id: string | null; name: string; dataType: DataType; options: string; unitLabel: string; isRequired: boolean; isActive: boolean; sortOrder: string };

export function AttributesEditor({ attributes, usage, canEdit }: { attributes: Attr[]; usage: Record<string, number>; canEdit: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const open = (a?: Attr) => {
    setErrors({});
    setForm(
      a
        ? { id: a.id, name: a.name, dataType: a.dataType, options: a.options.join("\n"), unitLabel: a.unitLabel ?? "", isRequired: a.isRequired, isActive: a.isActive, sortOrder: String(a.sortOrder) }
        : { id: null, name: "", dataType: "TEXT", options: "", unitLabel: "", isRequired: false, isActive: true, sortOrder: String(attributes.length) },
    );
  };

  async function save() {
    if (!form) return;
    const body = {
      name: form.name,
      dataType: form.dataType,
      options: form.options.split("\n").map((s) => s.trim()).filter(Boolean),
      unitLabel: form.unitLabel,
      isRequired: form.isRequired,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
    };
    setBusy(true);
    try {
      if (form.id) await api(`/api/inventory/attributes/${form.id}`, { method: "PATCH", body });
      else await api("/api/inventory/attributes", { method: "POST", body });
      toast.success("บันทึกเรียบร้อย");
      setForm(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Attr) {
    if (!confirm(`ลบคุณสมบัติ "${a.name}"?`)) return;
    try {
      await api(`/api/inventory/attributes/${a.id}`, { method: "DELETE" });
      toast.success("ลบเรียบร้อย");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">คุณสมบัติ</CardTitle>
          <p className="text-xs text-muted-foreground">ฟิลด์เพิ่มเติมของสินค้า แสดงในแท็บ &quot;ข้อมูลเฉพาะ&quot; ของสินค้าทุกตัว</p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => open()}>
            <Plus /> เพิ่มคุณสมบัติ
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ชื่อ</TableHead>
              <TableHead>ชนิดข้อมูล</TableHead>
              <TableHead>ตัวเลือก / หน่วย</TableHead>
              <TableHead className="text-right">สินค้าที่ใช้</TableHead>
              <TableHead>สถานะ</TableHead>
              {canEdit && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {attributes.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  ยังไม่มีคุณสมบัติ
                </TableCell>
              </TableRow>
            )}
            {attributes.map((a) => (
              <TableRow key={a.id} data-testid="attribute-row">
                <TableCell className="font-medium">
                  {a.name}
                  {a.isRequired && <span className="text-destructive">*</span>}
                </TableCell>
                <TableCell>{ATTRIBUTE_TYPE_LABELS[a.dataType]}</TableCell>
                <TableCell className="max-w-xs text-sm text-muted-foreground">
                  {a.dataType === "SELECT" ? a.options.join(", ") : a.dataType === "NUMBER" ? (a.unitLabel ?? "-") : "-"}
                </TableCell>
                <TableCell className="text-right">{formatNumber(usage[a.id] ?? 0)}</TableCell>
                <TableCell>{a.isActive ? "ใช้งาน" : <Badge variant="secondary">ปิดใช้งาน</Badge>}</TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button size="icon-sm" variant="ghost" onClick={() => open(a)} aria-label={`แก้ไข ${a.name}`}>
                      <Pencil />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => remove(a)} aria-label={`ลบ ${a.name}`}>
                      <Trash2 />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={Boolean(form)} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "แก้ไขคุณสมบัติ" : "เพิ่มคุณสมบัติ"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="ชื่อ" htmlFor="attr-name" required error={errors.name}>
                <Input id="attr-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </FormField>
              <FormField label="ชนิดข้อมูล" htmlFor="attr-type" required error={errors.dataType}>
                <Select value={form.dataType} onValueChange={(v) => setForm({ ...form, dataType: v as DataType })}>
                  <SelectTrigger id="attr-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ATTRIBUTE_TYPE_LABELS) as DataType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {ATTRIBUTE_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              {form.dataType === "SELECT" && (
                <FormField label="ตัวเลือก" htmlFor="attr-options" required error={errors.options} hint="บรรทัดละ 1 ตัวเลือก" className="sm:col-span-2">
                  <Textarea id="attr-options" rows={5} value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} />
                </FormField>
              )}
              {form.dataType === "NUMBER" && (
                <FormField label="หน่วยกำกับ" htmlFor="attr-unit" hint="เช่น มม., ซม., กก." error={errors.unitLabel}>
                  <Input id="attr-unit" value={form.unitLabel} onChange={(e) => setForm({ ...form, unitLabel: e.target.value })} />
                </FormField>
              )}
              <FormField label="ลำดับ" htmlFor="attr-sort">
                <Input id="attr-sort" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/\D/g, "") })} />
              </FormField>
              <div className="flex items-center gap-2">
                <Switch id="attr-required" checked={form.isRequired} onCheckedChange={(c) => setForm({ ...form, isRequired: c })} />
                <Label htmlFor="attr-required">บังคับกรอก</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="attr-active" checked={form.isActive} onCheckedChange={(c) => setForm({ ...form, isActive: c })} />
                <Label htmlFor="attr-active">เปิดใช้งาน</Label>
              </div>
            </div>
          )}
          <DialogFooter className="items-center">
            {form?.id && <span className="mr-auto"><AuditHistory entityType="ProductAttribute" entityId={form.id} /></span>}
            <Button variant="outline" onClick={() => setForm(null)} disabled={busy}>
              ยกเลิก
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
