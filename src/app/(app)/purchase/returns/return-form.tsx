"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackageMinus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormField } from "@/components/form-field";
import { DocNumberField } from "@/components/doc-number-field";
import { DateField } from "@/components/date-field";
import { SearchSelect } from "@/components/search-select";
import { LookupSelect } from "@/components/lookup-select";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { formatNumber } from "@/lib/format";
import { parseQty, toMilli } from "@/lib/stock-rules";
import { purchaseReturnSchema } from "@/lib/validators";
import type { PurchaseStatus } from "@/lib/approval";
import type { ReturnableOrder } from "@/server/purchase-orders";
import { DocActionBar } from "../_components/doc-action-bar";
import { NoteTemplatePicker } from "../_components/purchase-ui";
import { linesFromOrder, type Reason, type ReturnValues } from "./return-values";

const payload = (v: ReturnValues) => ({
  docDate: v.docDate,
  orderId: v.orderId,
  reasonId: v.reasonId ?? "",
  note: v.note,
  lines: v.lines.filter((l) => l.quantity.trim() && parseQty(l.quantity) !== 0).map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity, note: l.note })),
});

export function ReturnForm({
  doc,
  initial,
  reasons: initialReasons,
  orderOptions,
  canEdit,
  canApproveNow,
  canCancel,
  canIssue,
}: {
  doc: { id: string; docNo: string; status: PurchaseStatus } | null;
  initial: ReturnValues;
  reasons: Reason[];
  /** ใบใหม่ที่ยังไม่ได้เลือก PO */
  orderOptions: { id: string; docNo: string; vendor: string }[];
  canEdit: boolean;
  canApproveNow: boolean;
  canCancel: boolean;
  canIssue: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [reasons, setReasons] = useState(initialReasons);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isDraft = !doc || doc.status === "DRAFT";
  const editable = canEdit && isDraft && !saving;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof ReturnValues>(k: K, val: ReturnValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const approvedLike = doc && ["APPROVED", "PARTIAL", "COMPLETED"].includes(doc.status);

  async function pickOrder(id: string) {
    try {
      const o = await api<ReturnableOrder>(`/api/purchase/orders/options?purpose=return&id=${id}`);
      setV((s) => ({ ...s, orderId: o.order.id, orderDocNo: o.order.docNo, vendorName: o.order.vendor.name, lines: linesFromOrder(o) }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function save(): Promise<boolean> {
    const fe: Record<string, string> = {};
    const parsed = purchaseReturnSchema.safeParse(payload(v));
    if (!parsed.success) for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
    // ฝั่ง client: ไม่เกินจำนวนที่คืนได้ (server ตรวจซ้ำแบบ lock)
    v.lines.forEach((l, i) => {
      const q = parseQty(l.quantity);
      if (l.quantity.trim() && q !== null && toMilli(q) > toMilli(l.returnable)) fe[`row.${i}`] = `เกินจำนวนที่คืนได้ (${formatNumber(l.returnable)})`;
    });
    if (Object.keys(fe).length) {
      setErrors(fe);
      toast.error(fe.lines ?? fe.orderId ?? fe.reasonId ?? "กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง");
      return false;
    }
    setErrors({});
    setSaving(true);
    try {
      if (!doc) {
        const res = await api<{ id: string; docNo: string }>("/api/purchase/returns", { method: "POST", body: payload(v) });
        toast.success(`สร้างใบส่งคืน ${res.docNo} แล้ว`);
        router.push(`/purchase/returns/${res.id}`);
      } else {
        await api(`/api/purchase/returns/${doc.id}`, { method: "PATCH", body: payload(v) });
        toast.success("บันทึกเรียบร้อย");
        router.refresh();
      }
      return true;
    } catch (err) {
      if (err instanceof ApiClientError) {
        // server ส่ง lines.<index ใน payload> → แปลงกลับเป็นแถวที่แสดง
        const sent = v.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.quantity.trim() && parseQty(l.quantity) !== 0);
        const mapped: Record<string, string> = {};
        for (const [k, m] of Object.entries(err.fields)) {
          const mm = /^lines\.(\d+)\./.exec(k);
          mapped[mm ? `row.${sent[Number(mm[1])]?.i}` : k] = m;
        }
        setErrors(mapped);
      }
      toast.error(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) => errors[k];
  const total = v.lines.reduce((n, l) => n + (parseQty(l.quantity) ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="เลขที่เอกสาร" htmlFor="docNumber">
            <DocNumberField prefix="RT" value={doc?.docNo} />
          </FormField>
          <FormField label="วันที่ออกเอกสาร" htmlFor="docDate" required error={err("docDate")}>
            <DateField id="docDate" value={v.docDate} onChange={(x) => set("docDate", x)} disabled={!editable} />
          </FormField>
          <FormField label="ใบสั่งซื้อ" htmlFor="orderId" required error={err("orderId")}>
            {doc || !editable ? (
              <Input id="orderId" value={v.orderDocNo} readOnly className="font-mono" />
            ) : (
              <SearchSelect
                id="orderId"
                value={v.orderId || null}
                onChange={pickOrder}
                options={orderOptions.map((o) => ({ value: o.id, label: o.docNo, hint: o.vendor }))}
                placeholder="- เลือกใบสั่งซื้อที่รับของแล้ว -"
              />
            )}
          </FormField>
          <FormField label="ผู้ขาย" htmlFor="vendorName">
            <Input id="vendorName" value={v.vendorName} readOnly />
          </FormField>
          <FormField label="เหตุผลการคืน" htmlFor="reasonId" required error={err("reasonId")}>
            <LookupSelect
              id="reasonId"
              kind="RETURN_REASON"
              value={v.reasonId}
              onChange={(x) => set("reasonId", x)}
              options={reasons.filter((r) => r.isActive || r.id === v.reasonId)}
              onOptionAdded={(o) => setReasons((s) => [...s, { ...o, isActive: true }])}
              disabled={!editable}
              canAdd={editable}
            />
          </FormField>
          <FormField label="หมายเหตุ" htmlFor="note" error={err("note")} className="sm:col-span-2 lg:col-span-3">
            <NoteTemplatePicker module="purchase" value={v.note} onChange={(x) => set("note", x)} disabled={!editable} />
            <Textarea id="note" rows={2} value={v.note} onChange={(e) => set("note", e.target.value)} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">รายการที่คืน</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {err("lines") && <p className="text-sm text-destructive">{err("lines")}</p>}
          {!v.orderId ? (
            <p className="py-6 text-center text-sm text-muted-foreground">เลือกใบสั่งซื้อก่อน</p>
          ) : v.lines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">ใบสั่งซื้อนี้ไม่มีรายการที่คืนได้ (ยังไม่ได้รับของ หรือคืนครบแล้ว)</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>สินค้า</TableHead>
                    <TableHead className="text-right">นำเข้าแล้ว</TableHead>
                    {isDraft && <TableHead className="text-right">คืนได้</TableHead>}
                    <TableHead className="w-36 text-right">จำนวนที่คืน</TableHead>
                    <TableHead>หน่วย</TableHead>
                    {approvedLike && <TableHead className="text-right">นำออกแล้ว</TableHead>}
                    <TableHead className="min-w-40">หมายเหตุ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {v.lines.map((l, i) => (
                    <TableRow key={l.orderLineId} data-testid="rt-line">
                      <TableCell>
                        <div className="font-mono text-xs">{l.productCode}</div>
                        <div className="text-sm">{l.productName}</div>
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(l.received)}</TableCell>
                      {isDraft && <TableCell className="text-right">{formatNumber(l.returnable)}</TableCell>}
                      <TableCell className="text-right">
                        {editable ? (
                          <>
                            <Input
                              aria-label={`จำนวนที่คืน ${l.productCode}`}
                              inputMode="decimal"
                              className="text-right"
                              placeholder="0"
                              value={l.quantity}
                              onChange={(e) => setV((s) => ({ ...s, lines: s.lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) }))}
                              aria-invalid={Boolean(err(`row.${i}`))}
                            />
                            {err(`row.${i}`) && <p className="mt-1 text-left text-xs text-destructive">{err(`row.${i}`)}</p>}
                          </>
                        ) : (
                          formatNumber(l.quantity || 0)
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{l.unit}</TableCell>
                      {approvedLike && <TableCell className="text-right">{formatNumber(l.issued ?? 0)}</TableCell>}
                      <TableCell>
                        <Input
                          aria-label={`หมายเหตุ ${l.productCode}`}
                          value={l.note}
                          onChange={(e) => setV((s) => ({ ...s, lines: s.lines.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) }))}
                          disabled={!editable}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-right text-sm">
                รวมจำนวนที่คืน <span className="font-semibold">{formatNumber(total)}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <DocActionBar
        kind="returns"
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
                <Link href={`/print/purchase/returns/${doc.id}`} target="_blank">
                  <Printer /> พิมพ์
                </Link>
              </Button>
              {canIssue && (doc.status === "APPROVED" || doc.status === "PARTIAL") && (
                <Button asChild variant="outline">
                  <Link href={`/inventory/issues/new?rt=${doc.id}`}>
                    <PackageMinus /> สร้าง &gt; ใบนำออก
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
