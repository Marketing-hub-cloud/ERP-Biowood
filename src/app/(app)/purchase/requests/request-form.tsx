"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Printer, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormField } from "@/components/form-field";
import { DocNumberField } from "@/components/doc-number-field";
import { DateField } from "@/components/date-field";
import { SearchSelect } from "@/components/search-select";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { formatNumber } from "@/lib/format";
import { purchaseRequestSchema } from "@/lib/validators";
import type { PurchaseStatus } from "@/lib/approval";
import type { PurchaseFormOptions } from "@/server/purchase-common";
import { DocActionBar } from "../_components/doc-action-bar";
import { NoteTemplatePicker } from "../_components/purchase-ui";

export type RequestLineValues = { key: string; productId: string; quantity: string; note: string; ordered?: number };
export type RequestValues = {
  docDate: string;
  requiredDate: string;
  requesterId: string;
  department: string;
  position: string;
  reference: string;
  warehouseId: string;
  note: string;
  lines: RequestLineValues[];
};

const NONE = "__none__";
let seq = 0;
const newLine = (): RequestLineValues => ({ key: `n${++seq}`, productId: "", quantity: "", note: "" });

const payload = (v: RequestValues) => ({
  ...v,
  requiredDate: v.requiredDate || null,
  warehouseId: v.warehouseId || null,
  lines: v.lines.map(({ productId, quantity, note }) => ({ productId, quantity, note })),
});

export function RequestForm({
  doc,
  initial,
  options,
  canEdit,
  canApproveNow,
  canCancel,
  canCreateOrder,
}: {
  doc: { id: string; docNo: string; status: PurchaseStatus } | null;
  initial: RequestValues;
  options: PurchaseFormOptions;
  canEdit: boolean;
  canApproveNow: boolean;
  canCancel: boolean;
  canCreateOrder: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isDraft = !doc || doc.status === "DRAFT";
  const editable = canEdit && isDraft && !saving;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof RequestValues>(k: K, val: RequestValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const setLine = (key: string, patch: Partial<RequestLineValues>) => setV((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const productMap = useMemo(() => new Map(options.products.map((p) => [p.id, p])), [options.products]);
  const productOpts = options.products
    .filter((p) => p.isActive || v.lines.some((l) => l.productId === p.id))
    .map((p) => ({ value: p.id, label: `${p.code} ${p.name}`, hint: p.unit }));
  const users = options.users.filter((u) => !u.inactive || u.id === v.requesterId);
  const warehouses = options.warehouses.filter((w) => w.isActive || w.id === v.warehouseId);
  const showOrdered = doc && doc.status !== "DRAFT" && doc.status !== "PENDING";

  async function save(): Promise<boolean> {
    const parsed = purchaseRequestSchema.safeParse(payload(v));
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      toast.error(fe.lines ?? "กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง");
      return false;
    }
    setErrors({});
    setSaving(true);
    try {
      if (!doc) {
        const res = await api<{ id: string; docNo: string }>("/api/purchase/requests", { method: "POST", body: payload(v) });
        toast.success(`สร้างใบขอซื้อ ${res.docNo} แล้ว`);
        router.push(`/purchase/requests/${res.id}`);
      } else {
        await api(`/api/purchase/requests/${doc.id}`, { method: "PATCH", body: payload(v) });
        toast.success("บันทึกเรียบร้อย");
        router.refresh();
      }
      return true;
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) => errors[k];
  const canOrder = canCreateOrder && doc && (doc.status === "APPROVED" || doc.status === "PARTIAL");

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="เลขที่เอกสาร" htmlFor="docNumber">
            <DocNumberField prefix="PR" value={doc?.docNo} />
          </FormField>
          <FormField label="วันที่ออกเอกสาร" htmlFor="docDate" required error={err("docDate")}>
            <DateField id="docDate" value={v.docDate} onChange={(x) => set("docDate", x)} disabled={!editable} />
          </FormField>
          <FormField label="ต้องการภายในวันที่" htmlFor="requiredDate" error={err("requiredDate")}>
            <DateField id="requiredDate" value={v.requiredDate} onChange={(x) => set("requiredDate", x)} disabled={!editable} />
          </FormField>
          <FormField label="คลังปลายทาง" htmlFor="warehouseId" error={err("warehouseId")}>
            <Select value={v.warehouseId || NONE} onValueChange={(x) => set("warehouseId", x === NONE ? "" : x)} disabled={!editable}>
              <SelectTrigger id="warehouseId" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>- ไม่ระบุ -</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.code} {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="ผู้ขอ" htmlFor="requesterId" required error={err("requesterId")}>
            <SearchSelect
              id="requesterId"
              value={v.requesterId}
              onChange={(id) => {
                const u = options.users.find((x) => x.id === id);
                setV((s) => ({ ...s, requesterId: id, department: u?.department ?? "", position: u?.position ?? "" }));
              }}
              options={users.map((u) => ({ value: u.id, label: u.name, hint: u.department ?? undefined }))}
              disabled={!editable}
            />
          </FormField>
          <FormField label="แผนก" htmlFor="department" error={err("department")}>
            <Input id="department" value={v.department} onChange={(e) => set("department", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="ตำแหน่ง" htmlFor="position" error={err("position")}>
            <Input id="position" value={v.position} onChange={(e) => set("position", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="เอกสารอ้างอิง" htmlFor="reference" error={err("reference")}>
            <Input id="reference" value={v.reference} onChange={(e) => set("reference", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="หมายเหตุ" htmlFor="note" error={err("note")} className="sm:col-span-2 lg:col-span-4">
            <NoteTemplatePicker module="purchase" value={v.note} onChange={(x) => set("note", x)} disabled={!editable} />
            <Textarea id="note" rows={2} value={v.note} onChange={(e) => set("note", e.target.value)} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">รายการสินค้า</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {err("lines") && <p className="text-sm text-destructive">{err("lines")}</p>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="min-w-64">สินค้า</TableHead>
                  <TableHead className="w-36 text-right">จำนวน</TableHead>
                  <TableHead className="w-20">หน่วย</TableHead>
                  {showOrdered && <TableHead className="w-28 text-right">สั่งซื้อแล้ว</TableHead>}
                  <TableHead className="min-w-40">หมายเหตุ</TableHead>
                  {editable && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.lines.map((l, i) => (
                  <TableRow key={l.key} data-testid="pr-line">
                    <TableCell className="align-top text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="align-top">
                      <SearchSelect
                        id={`product-${i}`}
                        value={l.productId || null}
                        onChange={(x) => setLine(l.key, { productId: x })}
                        options={productOpts}
                        placeholder="- เลือกสินค้า -"
                        disabled={!editable}
                        aria-invalid={Boolean(err(`lines.${i}.productId`))}
                      />
                      {err(`lines.${i}.productId`) && <p className="mt-1 text-xs text-destructive">{err(`lines.${i}.productId`)}</p>}
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        id={`qty-${i}`}
                        aria-label={`จำนวน รายการที่ ${i + 1}`}
                        inputMode="decimal"
                        className="text-right"
                        value={l.quantity}
                        onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                        disabled={!editable}
                        aria-invalid={Boolean(err(`lines.${i}.quantity`))}
                      />
                      {err(`lines.${i}.quantity`) && <p className="mt-1 text-xs text-destructive">{err(`lines.${i}.quantity`)}</p>}
                    </TableCell>
                    <TableCell className="align-top pt-4 text-sm">{productMap.get(l.productId)?.unit}</TableCell>
                    {showOrdered && (
                      <TableCell className="align-top pt-4 text-right" data-testid="pr-ordered">
                        {formatNumber(l.ordered ?? 0)}
                      </TableCell>
                    )}
                    <TableCell className="align-top">
                      <Input aria-label={`หมายเหตุ รายการที่ ${i + 1}`} value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} disabled={!editable} />
                    </TableCell>
                    {editable && (
                      <TableCell className="align-top">
                        <Button type="button" variant="ghost" size="icon" aria-label={`ลบรายการที่ ${i + 1}`} onClick={() => setV((s) => ({ ...s, lines: s.lines.filter((x) => x.key !== l.key) }))}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {editable && (
            <Button type="button" variant="outline" onClick={() => setV((s) => ({ ...s, lines: [...s.lines, newLine()] }))}>
              <Plus /> เพิ่มรายการ
            </Button>
          )}
        </CardContent>
      </Card>

      <DocActionBar
        kind="requests"
        docId={doc?.id ?? null}
        docNo={doc?.docNo}
        status={doc?.status ?? null}
        dirty={dirty}
        saving={saving}
        canEdit={canEdit}
        canApproveNow={canApproveNow}
        canCancel={canCancel}
        onSave={save}
        extra={
          doc && (
            <>
              <Button asChild variant="outline">
                <Link href={`/print/purchase/requests/${doc.id}`} target="_blank">
                  <Printer /> พิมพ์
                </Link>
              </Button>
              {canOrder && (
                <Button asChild variant="outline">
                  <Link href={`/purchase/orders/new?pr=${doc.id}`}>
                    <ShoppingCart /> สร้าง &gt; ใบสั่งซื้อ
                  </Link>
                </Button>
              )}
            </>
          )
        }
      />
    </div>
  );
}

export { newLine as newRequestLine };
