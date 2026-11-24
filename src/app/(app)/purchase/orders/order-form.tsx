"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileInput,
  PackagePlus,
  Plus,
  Printer,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { DocNumberField } from "@/components/doc-number-field";
import { DateField } from "@/components/date-field";
import { SearchSelect } from "@/components/search-select";
import { ContactPicker } from "@/components/contact-picker";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { formatDate, formatNumber } from "@/lib/format";
import {
  calcPurchaseOrder,
  formatMoney,
  VAT_MODE_LABELS,
  type VatMode,
} from "@/lib/purchase-calc";
import { purchaseOrderSchema } from "@/lib/validators";
import type { PurchaseStatus } from "@/lib/approval";
import type { PurchaseFormOptions } from "@/server/purchase-common";
import type { OpenRequestLine } from "@/server/purchase-requests";
import { DocActionBar } from "../_components/doc-action-bar";
import { NoteTemplatePicker } from "../_components/purchase-ui";
import {
  linesFromRequests,
  newOrderLine,
  type OrderLineValues,
  type OrderValues,
} from "./order-values";

const NONE = "__none__";

const payload = (v: OrderValues) => ({
  docDate: v.docDate,
  deliveryDate: v.deliveryDate || null,
  vendorId: v.vendor?.id ?? "",
  paymentTerms: v.paymentTerms,
  reference: v.reference,
  warehouseId: v.warehouseId || null,
  note: v.note,
  vatMode: v.vatMode,
  headerDiscount: v.headerDiscount,
  lines: v.lines.map((l) => ({
    productId: l.productId,
    requestLineId: l.requestLineId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount,
    note: l.note,
  })),
});

/** ตัวเลขที่ยังพิมพ์ไม่เสร็จ/ผิดรูปแบบ ถือเป็น 0 ระหว่างคำนวณยอดบนหน้าจอ */
const num = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  return /^\d+(\.\d+)?$/.test(t) ? t : "0";
};

export function OrderForm({
  doc,
  initial,
  options,
  canEdit,
  canApproveNow,
  canCancel,
  canReceive,
  canReturn,
}: {
  doc: { id: string; docNo: string; status: PurchaseStatus } | null;
  initial: OrderValues;
  options: PurchaseFormOptions;
  canEdit: boolean;
  canApproveNow: boolean;
  canCancel: boolean;
  canReceive: boolean;
  canReturn: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [prDialog, setPrDialog] = useState(false);
  const isDraft = !doc || doc.status === "DRAFT";
  const editable = canEdit && isDraft && !saving;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof OrderValues>(k: K, val: OrderValues[K]) =>
    setV((s) => ({ ...s, [k]: val }));
  const setLine = (k: string, patch: Partial<OrderLineValues>) =>
    setV((s) => ({
      ...s,
      lines: s.lines.map((l) => (l.key === k ? { ...l, ...patch } : l)),
    }));

  const productMap = useMemo(
    () => new Map(options.products.map((p) => [p.id, p])),
    [options.products],
  );
  const productOpts = options.products
    .filter((p) => p.isActive || v.lines.some((l) => l.productId === p.id))
    .map((p) => ({ value: p.id, label: `${p.code} ${p.name}`, hint: p.unit }));
  const warehouses = options.warehouses.filter(
    (w) => w.isActive || w.id === v.warehouseId,
  );
  const approvedLike =
    doc && ["APPROVED", "PARTIAL", "COMPLETED"].includes(doc.status);

  const calc = calcPurchaseOrder({
    lines: v.lines.map((l) => ({
      quantity: num(l.quantity),
      unitPrice: num(l.unitPrice),
      discount: num(l.discount),
    })),
    headerDiscount: num(v.headerDiscount),
    vatMode: v.vatMode,
  });

  async function save(): Promise<boolean> {
    const parsed = purchaseOrderSchema.safeParse(payload(v));
    const fe: Record<string, string> = {};
    if (!parsed.success)
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
    calc.errors.forEach((e) => (fe.headerDiscount ??= e));
    if (Object.keys(fe).length) {
      setErrors(fe);
      toast.error(fe.lines ?? fe.headerDiscount ?? "กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง");
      return false;
    }
    setErrors({});
    setSaving(true);
    try {
      if (!doc) {
        const res = await api<{ id: string; docNo: string }>(
          "/api/purchase/orders",
          { method: "POST", body: payload(v) },
        );
        toast.success(`สร้างใบสั่งซื้อ ${res.docNo} แล้ว`);
        router.push(`/purchase/orders/${res.id}`);
      } else {
        await api(`/api/purchase/orders/${doc.id}`, {
          method: "PATCH",
          body: payload(v),
        });
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

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="เลขที่เอกสาร" htmlFor="docNumber">
            <DocNumberField prefix="PO" value={doc?.docNo} />
          </FormField>
          <FormField
            label="วันที่ออกเอกสาร"
            htmlFor="docDate"
            required
            error={err("docDate")}
          >
            <DateField
              id="docDate"
              value={v.docDate}
              onChange={(x) => set("docDate", x)}
              disabled={!editable}
            />
          </FormField>
          <FormField
            label="วันที่ส่งของ"
            htmlFor="deliveryDate"
            error={err("deliveryDate")}
          >
            <DateField
              id="deliveryDate"
              value={v.deliveryDate}
              onChange={(x) => set("deliveryDate", x)}
              disabled={!editable}
            />
          </FormField>
          <FormField
            label="คลังปลายทาง"
            htmlFor="warehouseId"
            error={err("warehouseId")}
          >
            <Select
              value={v.warehouseId || NONE}
              onValueChange={(x) => set("warehouseId", x === NONE ? "" : x)}
              disabled={!editable}
            >
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
          <FormField
            label="ผู้ขาย"
            htmlFor="vendorId"
            required
            error={err("vendorId")}
            className="sm:col-span-2"
          >
            <ContactPicker
              id="vendorId"
              value={v.vendor}
              onChange={(c) => set("vendor", c)}
              role="vendor"
              disabled={!editable}
              invalid={Boolean(err("vendorId"))}
            />
          </FormField>
          <FormField
            label="เงื่อนไขการชำระ"
            htmlFor="paymentTerms"
            error={err("paymentTerms")}
          >
            <Input
              id="paymentTerms"
              placeholder="เช่น เครดิต 30 วัน"
              value={v.paymentTerms}
              onChange={(e) => set("paymentTerms", e.target.value)}
              disabled={!editable}
            />
          </FormField>
          <FormField
            label="เอกสารอ้างอิง"
            htmlFor="reference"
            error={err("reference")}
          >
            <Input
              id="reference"
              value={v.reference}
              onChange={(e) => set("reference", e.target.value)}
              disabled={!editable}
            />
          </FormField>
          <FormField
            label="หมายเหตุ"
            htmlFor="note"
            error={err("note")}
            className="sm:col-span-2 lg:col-span-4"
          >
            <NoteTemplatePicker
              module="purchase"
              value={v.note}
              onChange={(x) => set("note", x)}
              disabled={!editable}
            />
            <Textarea
              id="note"
              rows={2}
              value={v.note}
              onChange={(e) => set("note", e.target.value)}
              disabled={!editable}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
          <CardTitle className="mr-auto text-base">รายการสินค้า</CardTitle>
          {editable && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPrDialog(true)}
            >
              <FileInput /> เพิ่มจากใบขอซื้อ
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {err("lines") && (
            <p className="text-sm text-destructive">{err("lines")}</p>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="min-w-60">สินค้า</TableHead>
                  <TableHead className="w-28 text-right">จำนวน</TableHead>
                  <TableHead className="w-16">หน่วย</TableHead>
                  <TableHead className="w-32 text-right">ราคา/หน่วย</TableHead>
                  <TableHead className="w-28 text-right">ส่วนลด (บาท)</TableHead>
                  <TableHead className="w-32 text-right">จำนวนเงิน</TableHead>
                  {approvedLike && (
                    <TableHead className="w-24 text-right">นำเข้าแล้ว</TableHead>
                  )}
                  {approvedLike && (
                    <TableHead className="w-24 text-right">ส่งคืน</TableHead>
                  )}
                  <TableHead className="min-w-32">หมายเหตุ</TableHead>
                  {editable && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.lines.map((l, i) => {
                  const e = (f: string) => err(`lines.${i}.${f}`);
                  return (
                    <TableRow key={l.key} data-testid="po-line">
                      <TableCell className="align-top pt-4 text-muted-foreground">
                        {i + 1}
                      </TableCell>
                      <TableCell className="align-top">
                        {l.requestLineId ? (
                          <div className="pt-1.5 text-sm">
                            <div>
                              {productMap.get(l.productId)?.code}{" "}
                              {productMap.get(l.productId)?.name}
                            </div>
                            <div className="font-mono text-xs text-muted-foreground">
                              จาก {l.requestDocNo}
                            </div>
                          </div>
                        ) : (
                          <SearchSelect
                            id={`product-${i}`}
                            value={l.productId || null}
                            onChange={(x) => setLine(l.key, { productId: x })}
                            options={productOpts}
                            placeholder="- เลือกสินค้า -"
                            disabled={!editable}
                            aria-invalid={Boolean(e("productId"))}
                          />
                        )}
                        {e("productId") && (
                          <p className="mt-1 text-xs text-destructive">
                            {e("productId")}
                          </p>
                        )}
                      </TableCell>
                      {/* ลำดับเซลล์ต้องตรงหัวตาราง: จำนวน | หน่วย | ราคา/หน่วย | ส่วนลด */}
                      {(["quantity", "unit", "unitPrice", "discount"] as const).map(
                        (f) =>
                          f === "unit" ? (
                            <TableCell key="unit" className="align-top pt-4 text-sm">
                              {productMap.get(l.productId)?.unit}
                            </TableCell>
                          ) : (
                          <TableCell key={f} className="align-top">
                            {!editable ? (
                              <div className="pt-1.5 text-right tabular-nums">
                                {f === "quantity"
                                  ? formatNumber(l[f])
                                  : l[f]
                                    ? formatMoney(l[f])
                                    : "-"}
                              </div>
                            ) : (
                              <Input
                                aria-label={`${{ quantity: "จำนวน", unitPrice: "ราคาต่อหน่วย", discount: "ส่วนลด" }[f]} รายการที่ ${i + 1}`}
                                inputMode="decimal"
                                className="text-right"
                                value={l[f]}
                                onChange={(ev) =>
                                  setLine(l.key, { [f]: ev.target.value })
                                }
                                disabled={!editable}
                                aria-invalid={Boolean(e(f))}
                              />
                            )}
                            {e(f) && (
                              <p className="mt-1 text-xs text-destructive">
                                {e(f)}
                              </p>
                            )}
                          </TableCell>
                        ),
                      )}
                      <TableCell
                        className="align-top pt-4 text-right tabular-nums"
                        data-testid="line-amount"
                      >
                        {formatMoney(calc.lineAmounts[i])}
                      </TableCell>
                      {approvedLike && (
                        <TableCell
                          className="align-top pt-4 text-right"
                          data-testid="po-received"
                        >
                          {formatNumber(l.received ?? 0)}
                        </TableCell>
                      )}
                      {approvedLike && (
                        <TableCell className="align-top pt-4 text-right">
                          {formatNumber(l.returned ?? 0)}
                        </TableCell>
                      )}
                      <TableCell className="align-top">
                        {editable ? (
                          <Input
                            aria-label={`หมายเหตุ รายการที่ ${i + 1}`}
                            value={l.note}
                            onChange={(ev) =>
                              setLine(l.key, { note: ev.target.value })
                            }
                          />
                        ) : (
                          <div className="pt-1.5 text-sm">{l.note || "-"}</div>
                        )}
                      </TableCell>
                      {editable && (
                        <TableCell className="align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`ลบรายการที่ ${i + 1}`}
                            onClick={() =>
                              setV((s) => ({
                                ...s,
                                lines: s.lines.filter((x) => x.key !== l.key),
                              }))
                            }
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {editable && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setV((s) => ({ ...s, lines: [...s.lines, newOrderLine()] }))
              }
            >
              <Plus /> เพิ่มรายการ
            </Button>
          )}

          {/* ───── ยอดรวม ───── */}
          <div
            className="ml-auto grid w-full max-w-sm gap-2 text-sm"
            data-testid="po-totals"
          >
            <Row label="รวมเป็นเงิน" value={formatMoney(calc.subtotal)} />
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="headerDiscount">ส่วนลดท้ายบิล</label>
              <Input
                id="headerDiscount"
                inputMode="decimal"
                className="h-8 w-36 text-right"
                value={v.headerDiscount}
                onChange={(e) => set("headerDiscount", e.target.value)}
                disabled={!editable}
                aria-invalid={Boolean(err("headerDiscount"))}
              />
            </div>
            {err("headerDiscount") && (
              <p className="text-right text-xs text-destructive">
                {err("headerDiscount")}
              </p>
            )}
            <Row label="หลังหักส่วนลด" value={formatMoney(calc.afterDiscount)} />
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="vatMode">ภาษีมูลค่าเพิ่ม</label>
              <Select
                value={v.vatMode}
                onValueChange={(x) => set("vatMode", x as VatMode)}
                disabled={!editable}
              >
                <SelectTrigger id="vatMode" size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(VAT_MODE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {v.vatMode === "INCLUSIVE" && (
              <Row label="มูลค่าก่อน VAT" value={formatMoney(calc.beforeVat)} />
            )}
            <Row
              label={v.vatMode === "NONE" ? "VAT" : "VAT 7%"}
              value={formatMoney(calc.vatAmount)}
              testId="po-vat"
            />
            <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
              <span>ยอดรวมสุทธิ</span>
              <span className="tabular-nums" data-testid="po-total">
                {formatMoney(calc.total)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <DocActionBar
        kind="orders"
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
                <Link href={`/print/purchase/orders/${doc.id}`} target="_blank">
                  <Printer /> พิมพ์
                </Link>
              </Button>
              {canReceive &&
                (doc.status === "APPROVED" || doc.status === "PARTIAL") && (
                  <Button asChild variant="outline">
                    <Link href={`/inventory/receipts/new?po=${doc.id}`}>
                      <PackagePlus /> สร้าง &gt; ใบนำเข้า
                    </Link>
                  </Button>
                )}
              {canReturn &&
                (doc.status === "PARTIAL" || doc.status === "COMPLETED") && (
                  <Button asChild variant="outline">
                    <Link href={`/purchase/returns/new?po=${doc.id}`}>
                      <Undo2 /> สร้าง &gt; ใบส่งคืน
                    </Link>
                  </Button>
                )}
            </>
          )
        }
      />

      {prDialog && (
        <RequestPickerDialog
          excludeOrderId={doc?.id ?? null}
          existing={
            new Set(
              v.lines.map((l) => l.requestLineId).filter(Boolean) as string[],
            )
          }
          onClose={() => setPrDialog(false)}
          onAdd={(lines, warehouseId) => {
            setV((s) => ({
              ...s,
              warehouseId: s.warehouseId || warehouseId || "",
              lines: [
                ...s.lines.filter((l) => l.productId || l.requestLineId),
                ...linesFromRequests(lines),
              ],
            }));
            setPrDialog(false);
          }}
        />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="tabular-nums" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

type PrOption = {
  id: string;
  docNo: string;
  docDate: string;
  requester: string;
};

/** เลือก PR ที่อนุมัติแล้ว แล้วเลือกรายการคงค้างมาใส่ใบสั่งซื้อ */
function RequestPickerDialog({
  excludeOrderId,
  existing,
  onClose,
  onAdd,
}: {
  excludeOrderId: string | null;
  existing: Set<string>;
  onClose: () => void;
  onAdd: (lines: OpenRequestLine[], warehouseId: string | null) => void;
}) {
  const [prs, setPrs] = useState<PrOption[] | null>(null);
  const [lines, setLines] = useState<OpenRequestLine[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api<PrOption[]>("/api/purchase/requests/open-lines")
      .then((d) => !cancelled && setPrs(d))
      .catch((e) => {
        toast.error(errorMessage(e));
        if (!cancelled) setPrs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(id: string) {
    try {
      const sp = new URLSearchParams({ ids: id });
      if (excludeOrderId) sp.set("excludeOrder", excludeOrderId);
      const ls = (
        await api<OpenRequestLine[]>(`/api/purchase/requests/open-lines?${sp}`)
      ).filter((l) => !existing.has(l.requestLineId));
      setLines(ls);
      setPicked(new Set(ls.map((l) => l.requestLineId)));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>เพิ่มรายการจากใบขอซื้อ</DialogTitle>
          <DialogDescription>
            แสดงเฉพาะใบขอซื้อที่อนุมัติแล้วและยังสั่งซื้อไม่ครบ ระบบเติมจำนวนคงค้างให้ (แก้ลดได้)
          </DialogDescription>
        </DialogHeader>
        {lines === null ? (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {prs === null && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                กำลังโหลด...
              </p>
            )}
            {prs?.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                ไม่มีใบขอซื้อที่รอสั่งซื้อ
              </p>
            )}
            {prs?.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p.id)}
                className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="font-mono font-medium">{p.docNo}</span>
                <span className="text-muted-foreground">
                  {formatDate(p.docDate)}
                </span>
                <span className="ml-auto">{p.requester}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {lines.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                ไม่มีรายการคงค้าง (หรือเพิ่มไว้ในใบนี้แล้ว)
              </p>
            )}
            {lines.map((l) => (
              <label
                key={l.requestLineId}
                className="flex items-center gap-3 border-b py-2 text-sm"
              >
                <Checkbox
                  checked={picked.has(l.requestLineId)}
                  onCheckedChange={(c) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (c) n.add(l.requestLineId);
                      else n.delete(l.requestLineId);
                      return n;
                    })
                  }
                />
                <span className="font-mono text-xs">{l.productCode}</span>
                <span className="flex-1">{l.productName}</span>
                <span className="text-muted-foreground">
                  คงค้าง {formatNumber(l.remaining)} {l.unit}
                </span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          {lines !== null && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={() => setLines(null)}
            >
              ← เลือกใบอื่น
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            ปิด
          </Button>
          {lines !== null && (
            <Button
              onClick={() =>
                onAdd(
                  lines.filter((l) => picked.has(l.requestLineId)),
                  lines[0]?.warehouseId ?? null,
                )
              }
              disabled={!picked.size}
            >
              เพิ่ม {picked.size} รายการ
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
