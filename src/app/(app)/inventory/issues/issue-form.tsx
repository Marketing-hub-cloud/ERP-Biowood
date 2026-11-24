"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackageMinus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormField } from "@/components/form-field";
import { DocNumberField } from "@/components/doc-number-field";
import { DateField } from "@/components/date-field";
import { ScanInput } from "@/components/scan-input";
import { SearchSelect } from "@/components/search-select";
import { api, ApiClientError, errorMessage } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { DISABLED_ISSUE_TYPES, ISSUE_TYPE_LABELS, parseQty, sumQty, toMilli } from "@/lib/stock-rules";
import { issueSchema } from "@/lib/validators";
import type { SerialInfo } from "@/server/goods-issues";
import type { ContactOption } from "@/app/api/contact-options/route";
import type { ContactAddressOption } from "@/app/api/contact-options/[id]/route";
import { CancelDocDialog } from "../_components/cancel-doc-dialog";
import { ContactPicker } from "@/components/contact-picker";

type IssueType = keyof typeof ISSUE_TYPE_LABELS;
export type IssueLineView = { serial: SerialInfo; quantity: string; note: string };
/** รายการที่ต้องส่งคืนของใบส่งคืนที่อ้างอิง (ประเภทส่งคืน) */
export type ReturnRef = {
  id: string;
  docNo: string;
  lines: { returnLineId: string; productId: string; productCode: string; productName: string; unit: string; remaining: number }[];
};
export type IssueValues = {
  type: IssueType;
  docDate: string;
  purchaseReturn: ReturnRef | null;
  contact: ContactOption | null;
  recipientName: string;
  shippingAddress: string;
  note: string;
  lines: IssueLineView[];
};
export type IssueView = { id: string; docNo: string; status: "DRAFT" | "POSTED" | "CANCELLED"; values: IssueValues };

const NONE = "__none__";

const payload = (v: IssueValues, post: boolean) => ({
  type: v.type,
  docDate: v.docDate,
  contactId: v.contact?.id ?? null,
  purchaseReturnId: v.type === "RETURN" ? (v.purchaseReturn?.id ?? null) : null,
  recipientName: v.recipientName,
  shippingAddress: v.shippingAddress,
  note: v.note,
  lines: v.lines.map((l) => ({ serialId: l.serial.serialId, quantity: l.quantity, note: l.note })),
  post,
});

type OpenReturnResponse = {
  purchaseReturn: { id: string; docNo: string; vendor: ContactOption };
  lines: ReturnRef["lines"];
};

export function IssueForm({
  issue,
  defaults,
  canEdit,
  canPost,
  canCancel,
  returnOptions = [],
}: {
  issue: IssueView | null;
  defaults?: IssueValues;
  canEdit: boolean;
  canPost: boolean;
  canCancel: boolean;
  /** ใบส่งคืนที่อนุมัติแล้ว (ประเภทส่งคืน) */
  returnOptions?: { id: string; docNo: string; vendor: string }[];
}) {
  const router = useRouter();
  const initial = useMemo(() => issue?.values ?? defaults!, [issue, defaults]);
  const [v, setV] = useState<IssueValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [addresses, setAddresses] = useState<ContactAddressOption[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const isDraft = !issue || issue.status === "DRAFT";
  const editable = canEdit && isDraft && !saving;
  const set = <K extends keyof IssueValues>(k: K, val: IssueValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const contactId = v.contact?.id;
  // barcode ที่อยู่ในรายการ (ใช้ตรวจซ้ำระหว่างสแกนรัว ซึ่ง onScan อาจถือ state เก่า)
  const scannedRef = useRef(new Set(initial.lines.map((l) => l.serial.barcode)));
  useEffect(() => {
    scannedRef.current = new Set(v.lines.map((l) => l.serial.barcode));
  }, [v.lines]);

  // ที่อยู่ของผู้ติดต่อที่เลือก
  useEffect(() => {
    if (!contactId || !editable) return;
    let cancelled = false;
    fetch(`/api/contact-options/${contactId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: ContactAddressOption[]) => {
        if (cancelled) return;
        setAddresses(d);
        // ยังไม่ได้กรอกที่อยู่: ใช้ที่อยู่แรก (ที่อยู่จัดส่งหลัก) ให้
        setV((s) => (s.shippingAddress || !d[0] ? s : { ...s, shippingAddress: d[0].text, recipientName: s.recipientName || d[0].recipient || "" }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [contactId, editable]);

  async function onScan(code: string) {
    if (scannedRef.current.has(code)) {
      toast.warning(`${code} อยู่ในรายการแล้ว`);
      return;
    }
    try {
      const s = await api<SerialInfo>(`/api/inventory/serials/lookup?barcode=${encodeURIComponent(code)}`);
      if (s.balance <= 0) {
        toast.error(`${s.barcode} ไม่มีคงเหลือ`);
        return;
      }
      if (scannedRef.current.has(s.barcode)) {
        toast.warning(`${s.barcode} อยู่ในรายการแล้ว`);
        return;
      }
      let qty = s.balance;
      if (v.type === "RETURN") {
        const rt = v.purchaseReturn;
        if (!rt) {
          toast.error("กรุณาเลือกใบส่งคืนก่อนสแกน");
          return;
        }
        const left = returnLeft(rt, v.lines, s.productId);
        if (left === null) {
          toast.error(`${s.productCode} ไม่อยู่ในใบส่งคืน ${rt.docNo}`);
          return;
        }
        if (left <= 0) {
          toast.error(`${s.productCode} สแกนครบจำนวนที่ต้องส่งคืนแล้ว`);
          return;
        }
        qty = Math.min(qty, left);
      }
      scannedRef.current.add(s.barcode);
      setV((st) => (st.lines.some((l) => l.serial.serialId === s.serialId) ? st : { ...st, lines: [...st.lines, { serial: s, quantity: String(qty), note: "" }] }));
      toast.success(`เพิ่ม ${s.barcode} (${s.productCode}) คงเหลือ ${formatNumber(s.balance)} ${s.unit}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function pickReturn(id: string) {
    try {
      const r = await api<OpenReturnResponse>(`/api/purchase/returns/options?id=${id}`);
      setAddresses([]);
      setV((s) => ({
        ...s,
        purchaseReturn: { id: r.purchaseReturn.id, docNo: r.purchaseReturn.docNo, lines: r.lines },
        contact: r.purchaseReturn.vendor,
        recipientName: s.recipientName || r.purchaseReturn.vendor.name,
        shippingAddress: "",
        lines: [],
      }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function clientErrors(): Record<string, string> {
    const fe: Record<string, string> = {};
    const parsed = issueSchema.safeParse(payload(v, false));
    if (!parsed.success) for (const i of parsed.error.issues) fe[i.path.join(".")] ??= i.message;
    v.lines.forEach((l, i) => {
      const q = parseQty(l.quantity);
      if (q !== null && q > 0 && toMilli(q) > toMilli(l.serial.balance)) fe[`lines.${i}.quantity`] = `เกินคงเหลือ (${formatNumber(l.serial.balance)})`;
    });
    if (v.type === "RETURN" && v.purchaseReturn) {
      for (const rl of returnSummary(v.purchaseReturn, v.lines)) {
        if (toMilli(rl.scanned) > toMilli(rl.remaining)) {
          const i = v.lines.findIndex((l) => l.serial.productId === rl.productId);
          fe[`lines.${i}.quantity`] = `${rl.productCode}: เกินจำนวนที่ต้องส่งคืน (${formatNumber(rl.remaining)})`;
        }
      }
    }
    return fe;
  }

  async function submit(post: boolean) {
    const fe = clientErrors();
    if (post && !v.lines.length) fe.lines = "กรุณาสแกน SN ที่จะนำออก";
    if (Object.keys(fe).length) {
      setErrors(fe);
      toast.error(fe.lines ?? "กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (!issue) {
        const res = await api<{ id: string; docNo: string }>("/api/inventory/issues", { method: "POST", body: payload(v, post) });
        toast.success(post ? `นำออกเรียบร้อย (${res.docNo})` : `บันทึกร่าง ${res.docNo} แล้ว`);
        router.push(`/inventory/issues/${res.id}`);
      } else {
        await api(`/api/inventory/issues/${issue.id}`, { method: "PATCH", body: payload(v, post) });
        toast.success(post ? "นำออกเรียบร้อย" : "บันทึกเรียบร้อย");
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function cancelDoc(reason: string) {
    try {
      await api(`/api/inventory/issues/${issue!.id}/cancel`, { method: "POST", body: { reason } });
      toast.success("ยกเลิกใบนำออกเรียบร้อย");
      router.refresh();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  }

  // สรุปตามสินค้า
  const summary = useMemo(() => {
    const m = new Map<string, { code: string; name: string; unit: string; qty: number[]; sn: number }>();
    for (const l of v.lines) {
      const k = l.serial.productId;
      const cur = m.get(k) ?? { code: l.serial.productCode, name: l.serial.productName, unit: l.serial.unit, qty: [], sn: 0 };
      cur.qty.push(parseQty(l.quantity) ?? 0);
      cur.sn++;
      m.set(k, cur);
    }
    return [...m.values()].map((x) => ({ ...x, total: sumQty(x.qty) }));
  }, [v.lines]);

  const err = (k: string) => errors[k];
  const disabledTypes = DISABLED_ISSUE_TYPES as readonly string[];

  return (
    <div className="space-y-4">
      {issue?.status === "CANCELLED" && (
        <Alert variant="destructive">
          <AlertDescription>ใบนำออกนี้ถูกยกเลิกแล้ว</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="เลขที่เอกสาร" htmlFor="docNumber">
            <DocNumberField prefix="GI" value={issue?.docNo} />
          </FormField>
          <FormField label="ประเภท" htmlFor="type" required error={err("type")}>
            <Select
              value={v.type}
              onValueChange={(x) =>
                setV((s) => ({
                  ...s,
                  type: x as IssueType,
                  purchaseReturn: null,
                  // ออกจากประเภทส่งคืน: ล้างผู้รับที่มาจากใบส่งคืน
                  ...(s.type === "RETURN" || x === "RETURN" ? { contact: null, shippingAddress: "", lines: [] } : {}),
                }))
              }
              disabled={!editable}
            >
              <SelectTrigger id="type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ISSUE_TYPE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k} disabled={disabledTypes.includes(k)}>
                    {label}
                    {disabledTypes.includes(k) && " (เปิดใช้พร้อมระบบจัดซื้อ)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="วันที่เอกสาร" htmlFor="docDate" required error={err("docDate")}>
            <DateField id="docDate" value={v.docDate} onChange={(x) => set("docDate", x)} disabled={!editable} />
          </FormField>
          {v.type === "RETURN" && (
            <FormField label="ใบส่งคืน" htmlFor="purchaseReturnId" required error={err("purchaseReturnId")}>
              {!editable || v.lines.length > 0 ? (
                <Input id="purchaseReturnId" value={v.purchaseReturn?.docNo ?? ""} readOnly className="font-mono" />
              ) : (
                <SearchSelect
                  id="purchaseReturnId"
                  value={v.purchaseReturn?.id ?? null}
                  onChange={pickReturn}
                  options={returnOptions.map((r) => ({ value: r.id, label: r.docNo, hint: r.vendor }))}
                  placeholder="- เลือกใบส่งคืนที่อนุมัติแล้ว -"
                />
              )}
            </FormField>
          )}
          <FormField
            label={v.type === "SALE" ? "ลูกค้า" : v.type === "RETURN" ? "ผู้ขาย (ผู้รับคืน)" : "ผู้ติดต่อ"}
            htmlFor="contactId"
            required={v.type === "SALE"}
            error={err("contactId")}
          >
            <ContactPicker
              id="contactId"
              value={v.contact}
              onChange={(c) => {
                setAddresses([]);
                setV((s) => ({ ...s, contact: c, shippingAddress: c?.id === s.contact?.id ? s.shippingAddress : "" }));
              }}
              role={v.type === "SALE" ? "customer" : null}
              disabled={!editable || v.type === "RETURN"}
              invalid={Boolean(err("contactId"))}
            />
          </FormField>
          <FormField label="ชื่อผู้รับ" htmlFor="recipientName" error={err("recipientName")}>
            <Input id="recipientName" value={v.recipientName} onChange={(e) => set("recipientName", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="หมายเหตุ" htmlFor="note" error={err("note")}>
            <Input id="note" value={v.note} onChange={(e) => set("note", e.target.value)} disabled={!editable} />
          </FormField>
          <FormField label="ที่อยู่จัดส่ง" htmlFor="shippingAddress" error={err("shippingAddress")} className="sm:col-span-2 lg:col-span-3">
            {editable && addresses.length > 0 && (
              <Select
                value={NONE}
                onValueChange={(k) => {
                  const a = addresses.find((x) => x.key === k);
                  if (a) setV((s) => ({ ...s, shippingAddress: a.text, recipientName: a.recipient || s.recipientName }));
                }}
              >
                <SelectTrigger size="sm" className="mb-1.5 w-full sm:w-80" aria-label="เลือกที่อยู่ของผู้ติดต่อ">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>- เลือกจากที่อยู่ของผู้ติดต่อ -</SelectItem>
                  {addresses.map((a) => (
                    <SelectItem key={a.key} value={a.key}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Textarea id="shippingAddress" rows={2} value={v.shippingAddress} onChange={(e) => set("shippingAddress", e.target.value)} disabled={!editable} />
          </FormField>
        </CardContent>
      </Card>

      {v.type === "RETURN" && v.purchaseReturn && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">สินค้าที่ต้องส่งคืนตาม {v.purchaseReturn.docNo}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead className="text-right">ต้องคืน (คงค้าง)</TableHead>
                  <TableHead className="text-right">สแกนในใบนี้</TableHead>
                  <TableHead>หน่วย</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnSummary(v.purchaseReturn, v.lines).map((r) => (
                  <TableRow key={r.productId} data-testid="return-expected">
                    <TableCell>
                      <span className="font-mono text-xs">{r.productCode}</span> {r.productName}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(r.remaining)}</TableCell>
                    <TableCell className={cn("text-right", toMilli(r.scanned) > toMilli(r.remaining) && "text-destructive")}>{formatNumber(r.scanned)}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
          <CardTitle className="mr-auto text-base">รายการนำออก</CardTitle>
          <Badge variant="secondary" data-testid="issue-count">
            {formatNumber(v.lines.length)} SN
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {editable && <ScanInput onScan={onScan} placeholder="สแกน barcode ที่จะนำออก หรือพิมพ์แล้วกด Enter" />}
          {err("lines") && <p className="text-sm text-destructive">{err("lines")}</p>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>SN / Barcode</TableHead>
                  <TableHead>สินค้า</TableHead>
                  <TableHead>คลัง / สถานที่</TableHead>
                  <TableHead>Lot</TableHead>
                  {isDraft && <TableHead className="text-right">คงเหลือ</TableHead>}
                  <TableHead className="w-40 text-right">จำนวนนำออก</TableHead>
                  <TableHead>หน่วย</TableHead>
                  {editable && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {v.lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      {editable ? "สแกน barcode เพื่อเพิ่มรายการ" : "ไม่มีรายการ"}
                    </TableCell>
                  </TableRow>
                )}
                {v.lines.map((l, i) => (
                  <TableRow key={l.serial.serialId} data-testid="issue-line">
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{l.serial.barcode}</TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{l.serial.productCode}</div>
                      <div className="text-sm">{l.serial.productName}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {l.serial.warehouse}
                      {l.serial.location && <div className="text-xs text-muted-foreground">{l.serial.location}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{l.serial.lot ?? "-"}</TableCell>
                    {isDraft && <TableCell className="text-right">{formatNumber(l.serial.balance)}</TableCell>}
                    <TableCell className="text-right">
                      {editable ? (
                        <div>
                          <Input
                            value={l.quantity}
                            inputMode="decimal"
                            aria-label={`จำนวนนำออก ${l.serial.barcode}`}
                            aria-invalid={Boolean(err(`lines.${i}.quantity`)) || undefined}
                            onChange={(e) => setV((s) => ({ ...s, lines: s.lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) }))}
                            className="text-right"
                          />
                          {err(`lines.${i}.quantity`) && <p className="mt-1 text-left text-xs text-destructive">{err(`lines.${i}.quantity`)}</p>}
                        </div>
                      ) : (
                        formatNumber(l.quantity)
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{l.serial.unit}</TableCell>
                    {editable && (
                      <TableCell>
                        <Button type="button" variant="ghost" size="icon" aria-label={`ลบ ${l.serial.barcode}`} onClick={() => setV((s) => ({ ...s, lines: s.lines.filter((_, j) => j !== i) }))}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
              {summary.length > 0 && (
                <TableFooter>
                  {summary.map((s) => (
                    <TableRow key={s.code}>
                      <TableCell colSpan={isDraft ? 6 : 5} className="text-right text-sm">
                        รวม <span className="font-mono">{s.code}</span> {s.name} ({s.sn} SN)
                      </TableCell>
                      <TableCell className="text-right font-semibold" data-testid="issue-total">
                        {formatNumber(s.total)}
                      </TableCell>
                      <TableCell colSpan={editable ? 2 : 1}>{s.unit}</TableCell>
                    </TableRow>
                  ))}
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>

      {(editable || (canCancel && issue && issue.status !== "CANCELLED")) && (
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {canCancel && issue && issue.status !== "CANCELLED" && (
            <Button type="button" variant="outline" className="mr-auto text-destructive" onClick={() => setCancelOpen(true)} disabled={saving}>
              ยกเลิกเอกสาร
            </Button>
          )}
          {editable && (
            <>
              <Button type="button" variant="outline" onClick={() => submit(false)} disabled={saving}>
                {saving ? "กำลังบันทึก..." : "บันทึกร่าง"}
              </Button>
              {canPost && (
                <Button type="button" onClick={() => submit(true)} disabled={saving || !v.lines.length}>
                  <PackageMinus /> นำออก
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {issue && (
        <CancelDocDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title={`ยกเลิกใบนำออก ${issue.docNo}?`}
          description={issue.status === "POSTED" ? "ระบบจะคืนยอดที่นำออกกลับเข้าคลัง (SN เดิม สถานที่เดิม)" : "ใบร่างนี้จะถูกยกเลิก"}
          onConfirm={cancelDoc}
        />
      )}
    </div>
  );
}

/** สรุปรายการที่ต้องส่งคืนต่อสินค้า: คงค้าง vs ที่สแกนในใบนี้ */
function returnSummary(rt: ReturnRef, lines: IssueLineView[]) {
  const byProduct = new Map<string, { productId: string; productCode: string; productName: string; unit: string; remaining: number; scanned: number }>();
  for (const l of rt.lines) {
    const cur = byProduct.get(l.productId) ?? { productId: l.productId, productCode: l.productCode, productName: l.productName, unit: l.unit, remaining: 0, scanned: 0 };
    cur.remaining = sumQty([cur.remaining, l.remaining]);
    byProduct.set(l.productId, cur);
  }
  for (const l of lines) {
    const cur = byProduct.get(l.serial.productId);
    if (cur) cur.scanned = sumQty([cur.scanned, parseQty(l.quantity) ?? 0]);
  }
  return [...byProduct.values()];
}

/** จำนวนที่ยังสแกนคืนได้ของสินค้านี้ (null = สินค้าไม่อยู่ในใบส่งคืน) */
function returnLeft(rt: ReturnRef, lines: IssueLineView[], productId: string): number | null {
  const r = returnSummary(rt, lines).find((x) => x.productId === productId);
  return r ? sumQty([r.remaining, -r.scanned]) : null;
}
