"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { AuditHistory } from "@/components/audit-history";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { NOTE_MODULES, noteTemplateSchema } from "@/lib/validators";

export type NoteRow = { id: string; module: string; title: string; body: string; sortOrder: number; isActive: boolean };
type Module = keyof typeof NOTE_MODULES;
type Draft = { id: string | null; module: Module; title: string; body: string; sortOrder: string; isActive: boolean };

export function RemarksEditor({ rows, canCreate, canEdit, canDelete }: { rows: NoteRow[]; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!draft) return;
    const body = { module: draft.module, title: draft.title, body: draft.body, sortOrder: draft.sortOrder || 0, isActive: draft.isActive };
    const parsed = noteTemplateSchema.safeParse(body);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      return;
    }
    setSaving(true);
    try {
      if (draft.id) await api(`/api/settings/note-templates/${draft.id}`, { method: "PATCH", body });
      else await api("/api/settings/note-templates", { method: "POST", body });
      toast.success("บันทึกหมายเหตุแล้ว");
      setDraft(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: NoteRow) {
    if (!window.confirm(`ลบหมายเหตุ "${r.title}"? (เอกสารที่ใช้ข้อความนี้ไปแล้วไม่ได้รับผลกระทบ)`)) return;
    try {
      await api(`/api/settings/note-templates/${r.id}`, { method: "DELETE" });
      toast.success("ลบหมายเหตุแล้ว");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      {(Object.keys(NOTE_MODULES) as Module[]).map((m) => {
        const list = rows.filter((r) => r.module === m);
        return (
          <Card key={m}>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <CardTitle className="mr-auto text-base">{NOTE_MODULES[m]}</CardTitle>
              {canCreate && (
                <Button
                  size="sm"
                  onClick={() => {
                    setErrors({});
                    setDraft({ id: null, module: m, title: "", body: "", sortOrder: String(list.length), isActive: true });
                  }}
                >
                  <Plus /> เพิ่มหมายเหตุ
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-56">ชื่อหมายเหตุ</TableHead>
                    <TableHead>ข้อความ</TableHead>
                    <TableHead className="w-24">สถานะ</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        ยังไม่มีหมายเหตุสำเร็จรูป
                      </TableCell>
                    </TableRow>
                  )}
                  {list.map((r) => (
                    <TableRow key={r.id} data-testid="note-row">
                      <TableCell className="font-medium">{r.title}</TableCell>
                      <TableCell>
                        <p className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{r.body}</p>
                      </TableCell>
                      <TableCell>{r.isActive ? <Badge variant="outline">ใช้งาน</Badge> : <Badge variant="secondary">ปิดใช้งาน</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <AuditHistory entityType="NoteTemplate" entityId={r.id} />
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`แก้ไข ${r.title}`}
                            onClick={() => {
                              setErrors({});
                              setDraft({ ...r, module: r.module as Module, sortOrder: String(r.sortOrder) });
                            }}
                          >
                            <Pencil />
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="icon" aria-label={`ลบ ${r.title}`} onClick={() => remove(r)}>
                            <Trash2 />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        {draft && (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {draft.id ? "แก้ไข" : "เพิ่ม"}หมายเหตุสำเร็จรูป · {NOTE_MODULES[draft.module]}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <FormField label="ชื่อหมายเหตุ" htmlFor="noteTitle" required error={errors.title}>
                <Input id="noteTitle" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </FormField>
              <FormField label="ข้อความ" htmlFor="noteBody" required error={errors.body}>
                <Textarea id="noteBody" rows={5} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              </FormField>
              <div className="flex items-end gap-4">
                <FormField label="ลำดับ" htmlFor="noteOrder" error={errors.sortOrder} className="w-24">
                  <Input id="noteOrder" inputMode="numeric" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} />
                </FormField>
                <div className="flex items-center gap-2 pb-2">
                  <Switch id="noteActive" checked={draft.isActive} onCheckedChange={(c) => setDraft({ ...draft, isActive: c })} />
                  <Label htmlFor="noteActive">เปิดใช้งาน</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDraft(null)}>
                ยกเลิก
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
