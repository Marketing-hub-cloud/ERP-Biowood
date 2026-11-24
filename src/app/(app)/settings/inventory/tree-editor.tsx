"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/form-field";
import { AuditHistory } from "@/components/audit-history";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { checkPlacement, childrenOf, descendantIds, flattenTree, pathLabel, subtreeDepth, TREE_CONFIG, type TreeKind, type TreeNode } from "@/lib/tree";
import { cn } from "@/lib/utils";

const ROOT = "__root__";

type FormState = { id: string | null; parentId: string | null; code: string; name: string; sortOrder: string; isActive: boolean };

export function TreeEditor({ kind, nodes, usage, canEdit }: { kind: TreeKind; nodes: TreeNode[]; usage: Record<string, number>; canEdit: boolean }) {
  const router = useRouter();
  const cfg = TREE_CONFIG[kind];
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TreeNode | null>(null);
  const itemLabel = kind === "locations" ? "สถานที่" : "หมวดหมู่";

  // ตัวเลือก "อยู่ภายใต้": ตัดตัวเอง/ลูกหลาน และรายการที่วางแล้วจะลึกเกิน
  const parentOptions = useMemo(() => {
    if (!form) return [];
    return flattenTree(nodes).filter((n) => checkPlacement(kind, nodes, n.id, form.id) === null);
  }, [form, nodes, kind]);

  function openNew(parent: TreeNode | null) {
    setErrors({});
    setForm({ id: null, parentId: parent?.id ?? null, code: "", name: "", sortOrder: "0", isActive: true });
  }
  function openEdit(n: TreeNode) {
    setErrors({});
    setForm({ id: n.id, parentId: n.parentId, code: n.code ?? "", name: n.name, sortOrder: String(n.sortOrder), isActive: n.isActive });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const body = { parentId: form.parentId, code: form.code, name: form.name, sortOrder: Number(form.sortOrder) || 0, isActive: form.isActive };
      if (form.id) await api(`/api/inventory/tree/${kind}/${form.id}`, { method: "PATCH", body });
      else await api(`/api/inventory/tree/${kind}`, { method: "POST", body });
      toast.success("บันทึกเรียบร้อย");
      setForm(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(n: TreeNode) {
    setSaving(true);
    try {
      await api(`/api/inventory/tree/${kind}/${n.id}`, { method: "DELETE" });
      toast.success("ลบเรียบร้อย");
      setConfirmDelete(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function renderNodes(parentId: string | null) {
    return childrenOf(nodes, parentId).map((n) => {
      const kids = childrenOf(nodes, n.id);
      const open = !collapsed[n.id];
      const used = usage[n.id] ?? 0;
      return (
        <li key={n.id}>
          <div
            className={cn("group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60", !n.isActive && "opacity-60")}
            style={{ paddingLeft: `${(n.level - cfg.rootLevel) * 24 + 8}px` }}
            data-testid="tree-node"
            data-level={n.level}
          >
            <button
              type="button"
              className={cn("flex size-5 items-center justify-center rounded hover:bg-muted", !kids.length && "invisible")}
              onClick={() => setCollapsed((c) => ({ ...c, [n.id]: open }))}
              aria-label={open ? "ยุบ" : "ขยาย"}
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
            {n.code && <Badge variant="outline" className="font-mono">{n.code}</Badge>}
            <span className="font-medium">{n.name}</span>
            <span className="text-xs text-muted-foreground">{cfg.levelNames[n.level]}</span>
            {!n.isActive && <Badge variant="secondary">ปิดใช้งาน</Badge>}
            {used > 0 && <span className="text-xs text-muted-foreground">· {kind === "categories" ? `สินค้า ${used}` : "มีการใช้งานในคลัง"}</span>}
            <span className="flex-1" />
            {canEdit && (
              <span className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                {n.level < cfg.maxLevel && (
                  <Button size="icon-sm" variant="ghost" onClick={() => openNew(n)} aria-label={`เพิ่ม${itemLabel}ย่อยใน ${n.name}`}>
                    <Plus />
                  </Button>
                )}
                <Button size="icon-sm" variant="ghost" onClick={() => openEdit(n)} aria-label={`แก้ไข ${n.name}`}>
                  <Pencil />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setConfirmDelete(n)} aria-label={`ลบ ${n.name}`}>
                  <Trash2 />
                </Button>
              </span>
            )}
          </div>
          {open && kids.length > 0 && <ul>{renderNodes(n.id)}</ul>}
        </li>
      );
    });
  }

  const editingNode = form?.id ? nodes.find((n) => n.id === form.id) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">{cfg.title}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {kind === "locations" ? "คลัง (ระดับ 0) แล้วซ้อนสถานที่ย่อยได้อีก 3 ระดับ เช่น โซน > ชั้น > ช่อง" : "ซ้อนได้ 3 ระดับ (หมวดหมู่ 1 > 2 > 3)"}
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => openNew(null)}>
            <Plus /> {kind === "locations" ? "เพิ่มคลัง" : "เพิ่มหมวดหมู่ 1"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {nodes.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล</p> : <ul className="space-y-0.5">{renderNodes(null)}</ul>}
      </CardContent>

      <Dialog open={Boolean(form)} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? `แก้ไข${itemLabel}` : `เพิ่ม${itemLabel}`}</DialogTitle>
            <DialogDescription>
              {form?.parentId ? `อยู่ภายใต้: ${pathLabel(nodes, form.parentId)}` : kind === "locations" ? "คลัง (ระดับบนสุด)" : "หมวดหมู่ 1 (ระดับบนสุด)"}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="อยู่ภายใต้" htmlFor="tree-parent" error={errors.parentId} className="sm:col-span-2">
                <Select value={form.parentId ?? ROOT} onValueChange={(v) => setForm({ ...form, parentId: v === ROOT ? null : v })}>
                  <SelectTrigger id="tree-parent" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {checkPlacement(kind, nodes, null, form.id) === null && (
                      <SelectItem value={ROOT}>- ระดับบนสุด ({kind === "locations" ? "คลัง" : "หมวดหมู่ 1"}) -</SelectItem>
                    )}
                    {parentOptions.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {"  ".repeat(n.level - cfg.rootLevel)}
                        {n.code ? `${n.code} · ` : ""}
                        {n.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editingNode && subtreeDepth(nodes, editingNode.id) > 0 && (
                  <p className="text-xs text-muted-foreground">ย้ายแล้วรายการย่อย {descendantIds(nodes, editingNode.id).length - 1} รายการจะย้ายตามไปด้วย</p>
                )}
              </FormField>
              <FormField label="รหัส" htmlFor="tree-code" required={cfg.codeRequired} error={errors.code}>
                <Input id="tree-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </FormField>
              <FormField label="ชื่อ" htmlFor="tree-name" required error={errors.name}>
                <Input id="tree-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </FormField>
              <FormField label="ลำดับ" htmlFor="tree-sort" hint="น้อยขึ้นก่อน (เท่ากันเรียงตามรหัส)">
                <Input id="tree-sort" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/\D/g, "") })} />
              </FormField>
              <div className="flex items-center gap-2 pt-6">
                <Switch id="tree-active" checked={form.isActive} onCheckedChange={(c) => setForm({ ...form, isActive: c })} />
                <Label htmlFor="tree-active">เปิดใช้งาน</Label>
              </div>
            </div>
          )}
          <DialogFooter className="items-center">
            {form?.id && <span className="mr-auto"><AuditHistory entityType={kind === "locations" ? "StockLocation" : "ProductCategory"} entityId={form.id} /></span>}
            <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "กำลังบันทึก..." : "บันทึก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบ &quot;{confirmDelete?.name}&quot;?</DialogTitle>
            <DialogDescription>ลบได้เฉพาะรายการที่ไม่มีรายการย่อยและยังไม่ถูกใช้งาน ถ้าใช้อยู่ให้ปิดใช้งานแทน</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              ยกเลิก
            </Button>
            <Button variant="destructive" onClick={() => confirmDelete && remove(confirmDelete)} disabled={saving}>
              ยืนยันลบ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
