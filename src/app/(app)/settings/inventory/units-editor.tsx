"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/client-api";
import { formatNumber } from "@/lib/format";

type Unit = { id: string; name: string; isActive: boolean; sortOrder: number };

export function UnitsEditor({ units, usage, canEdit }: { units: Unit[]; usage: Record<string, number>; canEdit: boolean }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">หน่วย</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit && (
          <form
            className="flex max-w-sm gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              if (await run(() => api("/api/inventory/units", { method: "POST", body: { name: newName } }), "เพิ่มหน่วยเรียบร้อย")) setNewName("");
            }}
          >
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อหน่วยใหม่ เช่น แผ่น" aria-label="ชื่อหน่วยใหม่" />
            <Button type="submit" disabled={busy || !newName.trim()}>
              <Plus /> เพิ่ม
            </Button>
          </form>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ชื่อหน่วย</TableHead>
              <TableHead className="w-32 text-right">สินค้าที่ใช้</TableHead>
              <TableHead className="w-28">เปิดใช้งาน</TableHead>
              {canEdit && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  ยังไม่มีหน่วย
                </TableCell>
              </TableRow>
            )}
            {units.map((u) => (
              <TableRow key={u.id} data-testid="unit-row">
                <TableCell>
                  {editing?.id === u.id ? (
                    <div className="flex max-w-xs gap-1">
                      <Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="แก้ไขชื่อหน่วย" />
                      <Button
                        size="icon"
                        disabled={busy}
                        aria-label="บันทึก"
                        onClick={async () => {
                          if (await run(() => api(`/api/inventory/units/${u.id}`, { method: "PATCH", body: { ...u, name: editing.name } }), "บันทึกเรียบร้อย")) setEditing(null);
                        }}
                      >
                        <Check />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditing(null)} aria-label="ยกเลิก">
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <span className="font-medium">{u.name}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">{formatNumber(usage[u.id] ?? 0)}</TableCell>
                <TableCell>
                  {canEdit ? (
                    <Switch
                      checked={u.isActive}
                      disabled={busy}
                      onCheckedChange={(c) => run(() => api(`/api/inventory/units/${u.id}`, { method: "PATCH", body: { ...u, isActive: c } }), c ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว")}
                      aria-label={`เปิดใช้งาน ${u.name}`}
                    />
                  ) : u.isActive ? (
                    "ใช้งาน"
                  ) : (
                    <Badge variant="secondary">ปิดใช้งาน</Badge>
                  )}
                </TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditing({ id: u.id, name: u.name })} aria-label={`แก้ไข ${u.name}`}>
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`ลบหน่วย "${u.name}"?`)) run(() => api(`/api/inventory/units/${u.id}`, { method: "DELETE" }), "ลบหน่วยเรียบร้อย");
                      }}
                      aria-label={`ลบ ${u.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
