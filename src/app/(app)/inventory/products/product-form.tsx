"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { LookupSelect } from "@/components/lookup-select";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { productSchema } from "@/lib/validators";
import { validateAttributeValues } from "@/lib/product-rules";
import { ancestry, childrenOf, type TreeNode } from "@/lib/tree";
import type { ProductFormOptions } from "@/server/products";
import { ProductImages } from "./product-images";

const NONE = "__none__";

export type ProductFormValues = {
  code: string;
  name: string;
  productTypeId: string | null;
  categoryId: string | null;
  description: string;
  isStockable: boolean;
  stockUnitId: string | null;
  isActive: boolean;
  attributes: Record<string, string>;
};

type Props = {
  mode: "create" | "edit";
  productId?: string;
  initial: ProductFormValues;
  options: ProductFormOptions;
  images: { id: string; url: string }[];
  canEdit: boolean;
  canDelete?: boolean;
  canAddType: boolean;
};

/** ฟิลด์ไหนอยู่แท็บไหน (ใช้สลับแท็บไปยัง error แรก) */
const TAB_OF: Record<string, string> = {
  code: "general",
  name: "general",
  productTypeId: "general",
  categoryId: "general",
  description: "general",
  isStockable: "stock",
  stockUnitId: "stock",
};
const tabOf = (key: string) => (key.startsWith("attributes.") ? "specific" : (TAB_OF[key] ?? "general"));

export function ProductForm({ mode, productId, initial, options, images, canEdit, canDelete, canAddType }: Props) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [types, setTypes] = useState(options.productTypes);
  const [tab, setTab] = useState("general");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = !canEdit || saving;
  const set = <K extends keyof ProductFormValues>(k: K, val: ProductFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  // หมวดหมู่ 1/2/3 จาก categoryId (เก็บระดับลึกสุดที่เลือก)
  const cats = options.categories;
  const chain = ancestry(cats, v.categoryId);
  const level = (n: number) => chain.find((c) => c.level === n)?.id ?? null;
  const visible = (nodes: TreeNode[]) => nodes.filter((n) => n.isActive || chain.some((c) => c.id === n.id));
  const catLevels = [
    { n: 1, label: "หมวดหมู่ 1", opts: visible(childrenOf(cats, null)), value: level(1) },
    { n: 2, label: "หมวดหมู่ 2", opts: level(1) ? visible(childrenOf(cats, level(1))) : [], value: level(2) },
    { n: 3, label: "หมวดหมู่ 3", opts: level(2) ? visible(childrenOf(cats, level(2))) : [], value: level(3) },
  ];
  const pickCategory = (n: number, id: string | null) => set("categoryId", id ?? (n > 1 ? level(n - 1) : null));

  const activeAttrs = options.attributes.filter((a) => a.isActive || v.attributes[a.id]);
  const units = options.units.filter((u) => u.isActive || u.id === v.stockUnitId);

  const errCount = (t: string) => Object.keys(errors).filter((k) => tabOf(k) === t).length;

  function showErrors(fe: Record<string, string>) {
    setErrors(fe);
    const first = Object.keys(fe)[0];
    if (first) setTab(tabOf(first));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fe: Record<string, string> = {};
    const parsed = productSchema.safeParse(v);
    if (!parsed.success) for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
    for (const [k, m] of Object.entries(validateAttributeValues(options.attributes, v.attributes))) fe[`attributes.${k}`] = m;
    if (Object.keys(fe).length) {
      showErrors(fe);
      toast.error("กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (mode === "create") {
        const res = await api<{ id: string }>("/api/products", { method: "POST", body: v });
        for (const f of pending) {
          const fd = new FormData();
          fd.append("file", f);
          await api(`/api/products/${res.id}/images`, { method: "POST", body: fd }).catch((err) => toast.error(`อัปโหลดรูป ${f.name} ไม่สำเร็จ: ${errorMessage(err)}`));
        }
        toast.success("สร้างสินค้าเรียบร้อย");
        router.push(`/inventory/products/${res.id}`);
      } else {
        await api(`/api/products/${productId}`, { method: "PATCH", body: v });
        toast.success("บันทึกเรียบร้อย");
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiClientError) showErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    setSaving(true);
    try {
      await api(`/api/products/${productId}`, { method: "DELETE" });
      toast.success("ลบสินค้าเรียบร้อย");
      router.push("/inventory/products");
    } catch (err) {
      toast.error(errorMessage(err));
      setSaving(false);
    }
  }

  const tabTrigger = (value: string, label: string) => (
    <TabsTrigger value={value}>
      {label}
      {errCount(value) > 0 && <Badge variant="destructive" className="ml-1 h-4 px-1.5 text-[10px]">{errCount(value)}</Badge>}
    </TabsTrigger>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList className="flex-wrap">
          {tabTrigger("general", "ทั่วไป")}
          {tabTrigger("stock", "คลัง")}
          {tabTrigger("specific", "ข้อมูลเฉพาะ")}
          {tabTrigger("onhand", "จำนวนสินค้าคงคลัง")}
        </TabsList>

        {/* ───── ทั่วไป ───── */}
        <TabsContent value="general" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="ประเภทสินค้า" htmlFor="productTypeId" error={errors.productTypeId}>
                <LookupSelect
                  id="productTypeId"
                  kind="PRODUCT_TYPE"
                  value={v.productTypeId}
                  onChange={(x) => set("productTypeId", x)}
                  options={types.filter((t) => t.isActive || t.id === v.productTypeId)}
                  onOptionAdded={(o) => setTypes((s) => [...s, { ...o, isActive: true }])}
                  disabled={disabled}
                  canAdd={canAddType}
                />
              </FormField>
              <FormField label="รหัสสินค้า" htmlFor="code" required error={errors.code}>
                <Input id="code" value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase())} disabled={disabled} className="font-mono" />
              </FormField>
              <FormField label="ชื่อสินค้า" htmlFor="name" required error={errors.name}>
                <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} disabled={disabled} />
              </FormField>
              {catLevels.map((c) => (
                <FormField key={c.n} label={c.label} htmlFor={`category-${c.n}`} error={c.n === 1 ? errors.categoryId : undefined}>
                  <Select value={c.value ?? NONE} onValueChange={(x) => pickCategory(c.n, x === NONE ? null : x)} disabled={disabled || (c.n > 1 && !catLevels[c.n - 2].value)}>
                    <SelectTrigger id={`category-${c.n}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>- ไม่ระบุ -</SelectItem>
                      {c.opts.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                          {!o.isActive && " (ปิดใช้งาน)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              ))}
              <FormField label="รายละเอียด" htmlFor="description" error={errors.description} className="sm:col-span-2 lg:col-span-3">
                <Textarea id="description" rows={4} value={v.description} onChange={(e) => set("description", e.target.value)} disabled={disabled} />
              </FormField>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                <Label>รูปภาพ</Label>
                <ProductImages productId={productId} saved={images} pending={pending} onPendingChange={setPending} canEdit={canEdit} />
              </div>
              {mode === "edit" && (
                <div className="flex items-center gap-2">
                  <Switch id="isActive" checked={v.isActive} onCheckedChange={(c) => set("isActive", c)} disabled={disabled} />
                  <Label htmlFor="isActive">เปิดใช้งาน</Label>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───── คลัง ───── */}
        <TabsContent value="stock" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox id="isStockable" checked={v.isStockable} onCheckedChange={(c) => set("isStockable", Boolean(c))} disabled={disabled} />
                สต๊อกได้ (ติดตามยอดคงเหลือ นำเข้า/นำออก)
              </label>
              <FormField label="หน่วยสต๊อก" htmlFor="stockUnitId" required={v.isStockable} error={errors.stockUnitId}>
                <Select value={v.stockUnitId ?? NONE} onValueChange={(x) => set("stockUnitId", x === NONE ? null : x)} disabled={disabled}>
                  <SelectTrigger id="stockUnitId" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>- เลือกหน่วย -</SelectItem>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                        {!u.isActive && " (ปิดใช้งาน)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───── ข้อมูลเฉพาะ ───── */}
        <TabsContent value="specific" forceMount className="data-[state=inactive]:hidden">
          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
              {activeAttrs.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีคุณสมบัติ (เพิ่มได้ที่ ตั้งค่า &gt; ตั้งค่าคลัง &gt; คุณสมบัติ)</p>}
              {activeAttrs.map((a) => {
                const id = `attr-${a.id}`;
                const val = v.attributes[a.id] ?? "";
                const setVal = (x: string) => set("attributes", { ...v.attributes, [a.id]: x });
                const label = a.unitLabel ? `${a.name} (${a.unitLabel})` : a.name;
                return (
                  <FormField key={a.id} label={`${label}${a.isActive ? "" : " (ปิดใช้งาน)"}`} htmlFor={id} required={a.isRequired && a.isActive} error={errors[`attributes.${a.id}`]}>
                    {a.dataType === "SELECT" ? (
                      <Select value={val || NONE} onValueChange={(x) => setVal(x === NONE ? "" : x)} disabled={disabled || !a.isActive}>
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>- ไม่ระบุ -</SelectItem>
                          {a.options.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input id={id} value={val} inputMode={a.dataType === "NUMBER" ? "decimal" : undefined} onChange={(e) => setVal(e.target.value)} disabled={disabled || !a.isActive} />
                    )}
                  </FormField>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ───── จำนวนสินค้าคงคลัง (อ่านอย่างเดียว — ข้อมูลจริงมาในเฟส 4) ───── */}
        <TabsContent value="onhand">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>คลัง</TableHead>
                    <TableHead>สถานที่</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>SN / Barcode</TableHead>
                    <TableHead className="text-right">คงเหลือ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {mode === "create" ? "บันทึกสินค้าก่อน" : "ยังไม่มีสินค้าคงคลัง (ระบบนำเข้า/นำออกจะเปิดใช้ในเฟสถัดไป)"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {(canEdit || canDelete) && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {canDelete && mode === "edit" && (
            <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)} disabled={saving} className="mr-auto">
              <Trash2 /> ลบสินค้า
            </Button>
          )}
          {canEdit && (
            <>
              <Button type="button" variant="outline" onClick={() => router.push("/inventory/products")} disabled={saving}>
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
            <DialogTitle>ลบสินค้า &quot;{v.name}&quot;?</DialogTitle>
            <DialogDescription>สินค้าจะหายจากรายการ (ประวัติการเปลี่ยนแปลงยังเก็บไว้) ถ้ายังต้องการเก็บไว้ดูให้ใช้ &quot;ปิดใช้งาน&quot; แทน</DialogDescription>
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
