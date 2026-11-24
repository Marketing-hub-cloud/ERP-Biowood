"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, PackageCheck, Plus, Printer, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/form-field";
import { DocNumberField } from "@/components/doc-number-field";
import { DateField } from "@/components/date-field";
import { SearchSelect } from "@/components/search-select";
import { ScanInput } from "@/components/scan-input";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { formatNumber } from "@/lib/format";
import { DISABLED_RECEIPT_TYPES, parseQty, RECEIPT_TYPE_LABELS, sumQty, toMilli } from "@/lib/stock-rules";
import { generateSerialsSchema, receiptSchema } from "@/lib/validators";
import { descendantIds, flattenTree, type TreeNode } from "@/lib/tree";
import { cn } from "@/lib/utils";
import type { StockFormOptions } from "@/server/goods-receipts";
import { CancelDocDialog } from "../_components/cancel-doc-dialog";

export type SerialView = { id: string; barcode: string; qty: number; scannedAt: string | null };
export type ReceiptLineView = { id: string; productId: string; locationId: string | null; orderLineId: string | null; note: string; serials: SerialView[] };
export type ReceiptView = {
  id: string;
  docNo: string;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  type: "PURCHASE" | "OTHER";
  purchaseOrderId: string | null;
  orderDocNo: string | null;
  docDate: string;
  warehouseId: string;
  lot: string;
  note: string;
  lines: ReceiptLineView[];
};

/** ใบสั่งซื้อที่เลือกได้ (ประเภทสั่งซื้อ) */
export type OrderOption = { id: string; docNo: string; vendor: string; warehouseId: string | null };

type LineValues = { key: string; id: string | null; productId: string; locationId: string | null; orderLineId: string | null; note: string };
export type ReceiptValues = {
  type: "PURCHASE" | "OTHER";
  purchaseOrderId: string | null;
  orderDocNo: string | null;
  docDate: string;
  warehouseId: string;
  lot: string;
  note: string;
  lines: LineValues[];
};
type Values = ReceiptValues;

let keySeq = 0;
const newKey = () => `n${++keySeq}`;
const NONE = "__none__";

function toValues(r: ReceiptView): Values {
  return {
    type: r.type,
    purchaseOrderId: r.purchaseOrderId,
    orderDocNo: r.orderDocNo,
    docDate: r.docDate,
    warehouseId: r.warehouseId,
    lot: r.lot,
    note: r.note,
    lines: r.lines.map((l) => ({ key: l.id, id: l.id, productId: l.productId, locationId: l.locationId, orderLineId: l.orderLineId, note: l.note })),
  };
}

const payload = (v: Values) => ({
  type: v.type,
  purchaseOrderId: v.type === "PURCHASE" ? v.purchaseOrderId : null,
  docDate: v.docDate,
  warehouseId: v.warehouseId,
  lot: v.lot,
  note: v.note,
  lines: v.lines.map(({ id, productId, locationId, orderLineId, note }) => ({ id, productId, locationId, orderLineId: v.type === "PURCHASE" ? orderLineId : null, note })),
});

/** รายการคงค้างของ PO (จาก /api/purchase/orders/options) */
type OpenOrderResponse = {
  order: { id: string; docNo: string; warehouseId: string | null };
  lines: { orderLineId: string; productId: string; productCode: string; unit: string; isStockable: boolean; remaining: number }[];
};

type Props = {
  receipt: ReceiptView | null;
  /** ค่าเริ่มต้นของใบใหม่ */
  defaults?: Values;
  options: StockFormOptions;
  canEdit: boolean;
  canCancel: boolean;
  /** ใบสั่งซื้อที่เลือกได้ */
  orderOptions?: OrderOption[];
  /** คงค้างของแต่ละรายการ PO (orderLineId → จำนวน) */
  orderRemaining?: Record<string, number>;
};

export function ReceiptForm({ receipt, defaults, options, canEdit, canCancel, orderOptions = [], orderRemaining: initialRemaining = {} }: Props) {
  const router = useRouter();
  const initial = useMemo(() => (receipt ? toValues(receipt) : defaults!), [receipt, defaults]);
  const [v, setV] = useState<Values>(initial);
  const [serials, setSerials] = useState<Record<string, SerialView[]>>(() => Object.fromEntries((receipt?.lines ?? []).map((l) => [l.id, l.serials])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [genFor, setGenFor] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [bulkLocation, setBulkLocation] = useState<string>(NONE);
  const [scanLog, setScanLog] = useState<{ code: string; ok: boolean; msg: string }[]>([]);
  const [orderRemaining, setOrderRemaining] = useState(initialRemaining);

  const isDraft = !receipt || receipt.status === "DRAFT";
  const editable = canEdit && isDraft && !saving;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((s) => ({ ...s, [k]: val }));
  const setLine = (key: string, patch: Partial<LineValues>) => setV((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  // ───── ตัวเลือก ─────
  const nodes = options.locations;
  const warehouses = nodes.filter((n) => n.level === 0 && (n.isActive || n.id === v.warehouseId));
  const locationOpts = useMemo(() => {
    if (!v.warehouseId) return [];
    const ids = new Set(descendantIds(nodes, v.warehouseId));
    const used = new Set(v.lines.map((l) => l.locationId));
    return flattenTree(nodes)
      .filter((n) => ids.has(n.id) && (n.isActive || used.has(n.id)))
      .map((n: TreeNode) => ({
        value: n.id,
        label: n.level === 0 ? `${n.code} (ตัวคลัง)` : `${"  ".repeat(n.level - 1)}${n.code} ${n.name}`,
      }));
  }, [nodes, v.warehouseId, v.lines]);
  const productMap = useMemo(() => new Map(options.products.map((p) => [p.id, p])), [options.products]);
  const productOpts = options.products
    .filter((p) => p.isActive || v.lines.some((l) => l.productId === p.id))
    .map((p) => ({ value: p.id, label: `${p.code} ${p.name}`, hint: p.unit }));

  // ───── สรุป SN ─────
  const allSerials = Object.values(serials).flat();
  const scanned = allSerials.filter((s) => s.scannedAt).length;
  const allScanned = allSerials.length > 0 && scanned === allSerials.length;
  const savedLineIds = new Set(receipt?.lines.map((l) => l.id) ?? []);
  const linesMissingSerials = v.lines.some((l) => !l.id || !(serials[l.id]?.length));
  const canPost = editable && receipt && !dirty && allScanned && !linesMissingSerials && v.lines.every((l) => l.locationId);

  function showErrors(fe: Record<string, string>) {
    setErrors(fe);
  }

  // ───── บันทึก ─────
  async function save(): Promise<boolean> {
    const parsed = receiptSchema.safeParse(payload(v));
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      showErrors(fe);
      toast.error("กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง");
      return false;
    }
    setErrors({});
    setSaving(true);
    try {
      if (!receipt) {
        const res = await api<{ id: string; docNo: string }>("/api/inventory/receipts", { method: "POST", body: payload(v) });
        toast.success(`สร้างใบนำเข้า ${res.docNo} แล้ว ขั้นต่อไป: สร้าง Barcode/SN ในแต่ละรายการ`);
        router.push(`/inventory/receipts/${res.id}`);
      } else {
        await api(`/api/inventory/receipts/${receipt.id}`, { method: "PATCH", body: payload(v) });
        toast.success("บันทึกเรียบร้อย");
        router.refresh();
      }
      return true;
    } catch (err) {
      if (err instanceof ApiClientError) showErrors(err.fields);
      toast.error(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function post() {
    if (!receipt) return;
    setSaving(true);
    try {
      await api(`/api/inventory/receipts/${receipt.id}/post`, { method: "POST" });
      toast.success(`นำเข้าคลังเรียบร้อย (${formatNumber(allSerials.length)} SN)`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) showErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function cancelDoc(reason: string) {
    try {
      await api(`/api/inventory/receipts/${receipt!.id}/cancel`, { method: "POST", body: { reason } });
      toast.success("ยกเลิกใบนำเข้าเรียบร้อย");
      router.refresh();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  }

  // ───── SN ─────
  async function deleteSerials(lineId: string, serialIds?: string[]) {
    try {
      await api(`/api/inventory/receipts/${receipt!.id}/lines/${lineId}/serials`, { method: "DELETE", body: { serialIds } });
      setSerials((s) => ({ ...s, [lineId]: serialIds ? (s[lineId] ?? []).filter((x) => !serialIds.includes(x.id)) : [] }));
      toast.success("ลบ SN แล้ว");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function onScan(code: string) {
    if (!receipt) return;
    try {
      const res = await api<{ serialId: string; lineId: string; barcode: string; scannedAt: string; already: boolean }>(`/api/inventory/receipts/${receipt.id}/scan`, {
        method: "POST",
        body: { barcode: code },
      });
      setSerials((s) => ({ ...s, [res.lineId]: (s[res.lineId] ?? []).map((x) => (x.id === res.serialId ? { ...x, scannedAt: res.scannedAt } : x)) }));
      setScanLog((l) => [{ code: res.barcode, ok: !res.already, msg: res.already ? "สแกนซ้ำ (สแกนไปแล้ว)" : "สแกนแล้ว" }, ...l].slice(0, 6));
      if (res.already) toast.warning(`${res.barcode} สแกนไปแล้ว`);
    } catch (err) {
      setScanLog((l) => [{ code, ok: false, msg: errorMessage(err) }, ...l].slice(0, 6));
      toast.error(errorMessage(err));
    }
  }

  async function unscan(lineId: string, s: SerialView) {
    try {
      await api(`/api/inventory/receipts/${receipt!.id}/scan`, { method: "POST", body: { barcode: s.barcode, undo: true } });
      setSerials((m) => ({ ...m, [lineId]: (m[lineId] ?? []).map((x) => (x.id === s.id ? { ...x, scannedAt: null } : x)) }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function pickOrder(id: string) {
    try {
      const o = await api<OpenOrderResponse>(`/api/purchase/orders/options?purpose=receipt&id=${id}`);
      const open = o.lines.filter((l) => l.isStockable && toMilli(l.remaining) > 0);
      if (!open.length) toast.warning("ใบสั่งซื้อนี้ไม่มีรายการคงค้างที่สต๊อกได้");
      setOrderRemaining(Object.fromEntries(o.lines.map((l) => [l.orderLineId, l.remaining])));
      setV((s) => ({
        ...s,
        purchaseOrderId: o.order.id,
        orderDocNo: o.order.docNo,
        warehouseId: s.warehouseId || o.order.warehouseId || "",
        lines: open.map((l) => ({ key: newKey(), id: null, productId: l.productId, locationId: null, orderLineId: l.orderLineId, note: "" })),
      }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const removeLine = (key: string) => setV((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));
  const err = (k: string) => errors[k];
  const lineErr = (i: number, f: string) => errors[`lines.${i}.${f}`];

  return (
    <div className="space-y-4">
      {receipt?.status === "CANCELLED" && (
        <Alert variant="destructive">
          <AlertDescription>ใบนำเข้านี้ถูกยกเลิกแล้ว</AlertDescription>
        </Alert>
      )}

      {/* ───── หัวเอกสาร ───── */}
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="เลขที่เอกสาร" htmlFor="docNumber">
            <DocNumberField prefix="GR" value={receipt?.docNo} />
          </FormField>
          <FormField label="ประเภท" htmlFor="type" required error={err("type")}>
            <Select
              value={v.type}
              onValueChange={(x) =>
                setV((s) => ({
                  ...s,
                  type: x as Values["type"],
                  purchaseOrderId: null,
                  orderDocNo: null,
                  // เปลี่ยนประเภท: รายการแบบสั่งซื้อต้องมาจาก PO
                  lines: x === "PURCHASE" ? [] : s.lines.map((l) => ({ ...l, orderLineId: null })),
                }))
              }
              disabled={!editable || allSerials.length > 0}
            >
              <SelectTrigger id="type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(RECEIPT_TYPE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k} disabled={(DISABLED_RECEIPT_TYPES as readonly string[]).includes(k)}>
                    {label}
                    {(DISABLED_RECEIPT_TYPES as readonly string[]).includes(k) && " (เปิดใช้พร้อมระบบจัดซื้อ)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {v.type === "PURCHASE" && (
            <FormField label="ใบสั่งซื้อ" htmlFor="purchaseOrderId" required error={err("purchaseOrderId")}>
              {!editable || allSerials.length > 0 ? (
                <Input id="purchaseOrderId" value={v.orderDocNo ?? ""} readOnly className="font-mono" />
              ) : (
                <SearchSelect
                  id="purchaseOrderId"
                  value={v.purchaseOrderId}
                  onChange={pickOrder}
                  options={orderOptions.map((o) => ({ value: o.id, label: o.docNo, hint: o.vendor }))}
                  placeholder="- เลือกใบสั่งซื้อที่อนุมัติแล้ว -"
                />
              )}
            </FormField>
          )}
          <FormField label="วันที่เอกสาร" htmlFor="docDate" required error={err("docDate")}>
            <DateField id="docDate" value={v.docDate} onChange={(x) => set("docDate", x)} disabled={!editable} />
          </FormField>
          <FormField label="คลัง" htmlFor="warehouseId" required error={err("warehouseId")}>
            <Select
              value={v.warehouseId || NONE}
              onValueChange={(x) => {
                const wh = x === NONE ? "" : x;
                const keep = new Set(wh ? descendantIds(nodes, wh) : []);
                // เปลี่ยนคลัง: ล้างสถานที่ที่ไม่อยู่ในคลังใหม่
                setV((s) => ({ ...s, warehouseId: wh, lines: s.lines.map((l) => (l.locationId && !keep.has(l.locationId) ? { ...l, locationId: null } : l)) }));
              }}
              disabled={!editable}
            >
              <SelectTrigger id="warehouseId" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>- เลือกคลัง -</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.code} {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Lot" htmlFor="lot" error={err("lot")}>
            <Input id="lot" value={v.lot} onChange={(e) => set("lot", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="หมายเหตุ" htmlFor="note" error={err("note")} className="sm:col-span-2 lg:col-span-1">
            <Textarea id="note" rows={1} value={v.note} onChange={(e) => set("note", e.target.value)} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      {/* ───── รายการสินค้า ───── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
          <CardTitle className="mr-auto text-base">รายการสินค้า</CardTitle>
          {editable && v.lines.length > 1 && (
            <div className="flex items-center gap-2">
              <Select value={bulkLocation} onValueChange={setBulkLocation}>
                <SelectTrigger size="sm" className="w-56" aria-label="สถานที่สำหรับทุกรายการ">
                  <SelectValue placeholder="สถานที่สำหรับทุกรายการ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>- สถานที่สำหรับทุกรายการ -</SelectItem>
                  {locationOpts.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={bulkLocation === NONE}
                onClick={() => setV((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, locationId: bulkLocation })) }))}
              >
                ใช้กับทุกรายการ
              </Button>
            </div>
          )}
          {receipt && allSerials.length > 0 && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/print/labels/${receipt.id}`} target="_blank">
                <Printer /> พิมพ์ทั้งหมด
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {errors.lines && <p className="text-sm text-destructive">{errors.lines}</p>}
          {v.lines.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {v.type === "PURCHASE" ? "เลือกใบสั่งซื้อ ระบบจะดึงรายการคงค้างมาให้" : <>ยังไม่มีรายการ กด &quot;เพิ่มรายการ&quot; เพื่อเลือกสินค้า</>}
            </p>
          )}
          {v.lines.map((l, i) => {
            const p = productMap.get(l.productId);
            const ss = (l.id && serials[l.id]) || [];
            const qty = sumQty(ss.map((s) => s.qty));
            const done = ss.filter((s) => s.scannedAt).length;
            const open = expanded[l.key] ?? ss.length <= 20;
            const saved = l.id !== null && savedLineIds.has(l.id);
            return (
              <div key={l.key} className="rounded-lg border" data-testid="receipt-line">
                <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] md:items-start">
                  <span className="pt-2 text-sm text-muted-foreground">{i + 1}</span>
                  <FormField label="สินค้า" htmlFor={`product-${l.key}`} required error={lineErr(i, "productId")}>
                    <SearchSelect
                      id={`product-${l.key}`}
                      value={l.productId || null}
                      onChange={(x) => setLine(l.key, { productId: x })}
                      options={productOpts}
                      placeholder="- เลือกสินค้า -"
                      disabled={!editable || ss.length > 0 || Boolean(l.orderLineId)}
                      aria-invalid={Boolean(lineErr(i, "productId"))}
                    />
                    {l.orderLineId && orderRemaining[l.orderLineId] !== undefined && (
                      <p
                        className={cn("mt-1 text-xs", toMilli(qty) > toMilli(orderRemaining[l.orderLineId]) ? "text-destructive" : "text-muted-foreground")}
                        data-testid="po-remaining"
                      >
                        คงค้างตามใบสั่งซื้อ {formatNumber(orderRemaining[l.orderLineId])} {p?.unit}
                        {toMilli(qty) > toMilli(orderRemaining[l.orderLineId]) && " — SN รวมเกินคงค้าง"}
                      </p>
                    )}
                  </FormField>
                  <FormField label="สถานที่จัดเก็บ" htmlFor={`location-${l.key}`} error={lineErr(i, "locationId")}>
                    <Select value={l.locationId ?? NONE} onValueChange={(x) => setLine(l.key, { locationId: x === NONE ? null : x })} disabled={!editable || !v.warehouseId}>
                      <SelectTrigger id={`location-${l.key}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{v.warehouseId ? "- เลือกสถานที่ -" : "- เลือกคลังก่อน -"}</SelectItem>
                        {locationOpts.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label="หมายเหตุ" htmlFor={`note-${l.key}`} error={lineErr(i, "note")}>
                    <Input id={`note-${l.key}`} value={l.note} onChange={(e) => setLine(l.key, { note: e.target.value })} disabled={!editable} />
                  </FormField>
                  {editable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="md:mt-6"
                      aria-label={`ลบรายการที่ ${i + 1}`}
                      onClick={() => {
                        if (ss.length && !window.confirm(`รายการนี้มี ${ss.length} SN ถ้าลบรายการ SN ทั้งหมดจะถูกลบเมื่อบันทึก (label ที่พิมพ์ไปแล้วจะใช้ไม่ได้) ต้องการลบหรือไม่?`)) return;
                        removeLine(l.key);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>

                {/* ───── Barcode / SN ───── */}
                <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2 text-sm">
                  <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => setExpanded((e) => ({ ...e, [l.key]: !open }))} disabled={!ss.length}>
                    {ss.length ? open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" /> : null}
                    Barcode/SN {formatNumber(ss.length)} รายการ
                  </button>
                  {ss.length > 0 && (
                    <>
                      <span className="text-muted-foreground">
                        · รวม <span data-testid="line-qty">{formatNumber(qty)}</span> {p?.unit}
                      </span>
                      <Badge variant={done === ss.length ? "default" : "secondary"}>
                        สแกนแล้ว {done}/{ss.length}
                      </Badge>
                    </>
                  )}
                  {lineErr(i, "serials") && <span className="text-destructive">{lineErr(i, "serials")}</span>}
                  <span className="flex-1" />
                  {receipt && l.id && ss.length > 0 && (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/print/labels/${receipt.id}?line=${l.id}`} target="_blank">
                        <Printer /> พิมพ์
                      </Link>
                    </Button>
                  )}
                  {editable && ss.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => window.confirm(`ลบ SN ทั้งหมด ${ss.length} รายการของสินค้านี้?`) && deleteSerials(l.id!)}
                    >
                      ลบ SN ทั้งหมด
                    </Button>
                  )}
                  {editable && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!saved || dirty}
                      title={!saved || dirty ? "บันทึกเอกสารก่อนสร้าง SN" : undefined}
                      onClick={() => setGenFor(l.id)}
                      aria-label={`สร้าง Barcode/SN รายการที่ ${i + 1}`}
                    >
                      <Plus /> สร้าง Barcode/SN
                    </Button>
                  )}
                </div>
                {open && ss.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t p-3">
                    {ss.map((s) => (
                      <span
                        key={s.id}
                        data-testid="serial-chip"
                        data-scanned={s.scannedAt ? "yes" : "no"}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs",
                          s.scannedAt ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "bg-background",
                        )}
                        title={s.scannedAt ? "สแกนแล้ว" : "รอสแกน"}
                      >
                        {s.scannedAt ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5 text-muted-foreground" />}
                        {s.barcode}
                        <span className="text-muted-foreground">×{formatNumber(s.qty)}</span>
                        {editable && s.scannedAt && (
                          <button type="button" className="ml-0.5 text-muted-foreground hover:text-foreground" onClick={() => unscan(l.id!, s)} aria-label={`ยกเลิกสแกน ${s.barcode}`}>
                            ↺
                          </button>
                        )}
                        {editable && !s.scannedAt && (
                          <button type="button" className="ml-0.5 text-muted-foreground hover:text-destructive" onClick={() => deleteSerials(l.id!, [s.id])} aria-label={`ลบ ${s.barcode}`}>
                            <X className="size-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {editable && v.type === "OTHER" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setV((s) => ({ ...s, lines: [...s.lines, { key: newKey(), id: null, productId: "", locationId: null, orderLineId: null, note: "" }] }))}
            >
              <Plus /> เพิ่มรายการ
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ───── สแกน ───── */}
      {receipt && isDraft && canEdit && allSerials.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <CardTitle className="mr-auto text-base">สแกน Barcode</CardTitle>
            <Badge variant={allScanned ? "default" : "secondary"} data-testid="scan-progress">
              สแกนแล้ว {scanned} / {allSerials.length}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {dirty && <p className="text-sm text-amber-700">มีการแก้ไขที่ยังไม่บันทึก กรุณาบันทึกก่อนสแกน</p>}
            <ScanInput onScan={onScan} disabled={dirty || saving} />
            {scanLog.length > 0 && (
              <ul className="space-y-1 text-sm">
                {scanLog.map((s, i) => (
                  <li key={i} className={cn("flex gap-2", s.ok ? "text-emerald-700" : "text-destructive")}>
                    <span className="font-mono">{s.code}</span>
                    <span>{s.msg}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* ───── ปุ่ม ───── */}
      {(editable || (canCancel && receipt && receipt.status !== "CANCELLED")) && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {canCancel && receipt && receipt.status !== "CANCELLED" && (
            <Button type="button" variant="outline" className="mr-auto text-destructive" onClick={() => setCancelOpen(true)} disabled={saving}>
              ยกเลิกเอกสาร
            </Button>
          )}
          {editable && (
            <>
              {receipt && !canPost && !dirty && (
                <span className="text-xs text-muted-foreground">
                  {linesMissingSerials ? "สร้าง SN ให้ครบทุกรายการ" : !allScanned ? "สแกนให้ครบทุก SN" : !v.lines.every((l) => l.locationId) ? "เลือกสถานที่จัดเก็บให้ครบ" : ""}
                  {" "}แล้วจึงกด &quot;นำเข้า&quot;
                </span>
              )}
              <Button type="button" variant={receipt ? "outline" : "default"} onClick={save} disabled={saving || (!!receipt && !dirty)}>
                {saving ? "กำลังบันทึก..." : receipt ? "บันทึก" : "บันทึกร่าง"}
              </Button>
              {receipt && (
                <Button type="button" onClick={post} disabled={!canPost}>
                  <PackageCheck /> นำเข้า
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {receipt && genFor && (
        <GenerateSerialsDialog
          receiptId={receipt.id}
          lineId={genFor}
          unit={productMap.get(v.lines.find((l) => l.id === genFor)?.productId ?? "")?.unit ?? ""}
          onClose={() => setGenFor(null)}
          onDone={() => {
            setGenFor(null);
            router.refresh();
          }}
        />
      )}
      {receipt && (
        <CancelDocDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title={`ยกเลิกใบนำเข้า ${receipt.docNo}?`}
          description={
            receipt.status === "POSTED"
              ? "ระบบจะตัดยอดที่นำเข้าออกจากคลัง (ทำได้เฉพาะเมื่อยังไม่มี SN ใดถูกนำออก) และ label ที่พิมพ์ไว้จะใช้ไม่ได้"
              : "ใบร่างนี้จะถูกยกเลิก และ label ที่พิมพ์ไว้จะใช้ไม่ได้"
          }
          onConfirm={cancelDoc}
        />
      )}
    </div>
  );
}

function GenerateSerialsDialog({ receiptId, lineId, unit, onClose, onDone }: { receiptId: string; lineId: string; unit: string; onClose: () => void; onDone: () => void }) {
  const [count, setCount] = useState("1");
  const [per, setPer] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const countRef = useRef<HTMLInputElement>(null);
  const n = Number(count);
  const q = parseQty(per);
  const total = Number.isInteger(n) && n > 0 && q ? sumQty(Array.from({ length: Math.min(n, 1000) }, () => q)) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = generateSerialsSchema.safeParse({ count, qtyPerSerial: per });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
      setErrors(fe);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ created: number }>(`/api/inventory/receipts/${receiptId}/lines/${lineId}/serials`, { method: "POST", body: parsed.data });
      toast.success(`สร้าง ${res.created} SN แล้ว`);
      onDone();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onOpenAutoFocus={(e) => (e.preventDefault(), countRef.current?.focus())}>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>สร้าง Barcode/SN</DialogTitle>
            <DialogDescription>ระบบสร้าง barcode ที่ไม่ซ้ำให้ทีละ SN เช่น 5 SN × 10 {unit || "ชิ้น"} = 50 {unit || "ชิ้น"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="จำนวน SN" htmlFor="snCount" required error={errors.count}>
              <Input ref={countRef} id="snCount" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
            </FormField>
            <FormField label={`จำนวนต่อ SN${unit ? ` (${unit})` : ""}`} htmlFor="qtyPerSerial" required error={errors.qtyPerSerial}>
              <Input id="qtyPerSerial" inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} />
            </FormField>
          </div>
          <p className="text-sm">
            รวม: <span className="font-semibold">{total !== null ? `${formatNumber(total)} ${unit}` : "-"}</span>
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              ปิด
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "กำลังสร้าง..." : "สร้าง"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
