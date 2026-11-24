import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate, formatNumber, fullName } from "@/lib/format";
import { formatAddress } from "@/lib/address";
import { calcPurchaseOrder, formatMoney, VAT_MODE_LABELS } from "@/lib/purchase-calc";
import { getCompany } from "@/server/company";
import { approvalHistory } from "@/server/approval";
import { InfoGrid, PrintDocument, PrintTable, Signatures } from "@/components/print/print-document";

const KINDS = {
  requests: { docType: "PR", menu: "purchase.request", th: "ใบขอซื้อ", en: "PurchaseRequest", back: "/purchase/requests" },
  orders: { docType: "PO", menu: "purchase.order", th: "ใบสั่งซื้อ", en: "PurchaseOrder", back: "/purchase/orders" },
  returns: { docType: "RT", menu: "purchase.return", th: "ใบส่งคืนสินค้า", en: "PurchaseReturn", back: "/purchase/returns" },
} as const;

export const metadata = { title: "พิมพ์เอกสาร" };

/** ผู้อนุมัติลำดับสุดท้ายของรอบล่าสุด (แสดงในช่องเซ็นชื่อ) */
async function lastApprover(docType: "PR" | "PO" | "RT", docId: string) {
  const h = await approvalHistory(docType, docId);
  const round = Math.max(0, ...h.map((x) => x.round));
  const last = h.filter((x) => x.round === round && x.action === "APPROVE").at(-1);
  return last ? { name: last.actorName, date: formatDate(last.createdAt) } : null;
}

async function vendorBlock(contactId: string) {
  const c = await prisma.contact.findUnique({ where: { id: contactId }, include: { channels: { orderBy: { sortOrder: "asc" } } } });
  if (!c) return null;
  const phone = c.channels.find((x) => x.type === "PHONE" || x.type === "MOBILE")?.value;
  const address = formatAddress({
    address: c.regAddress,
    houseNo: c.regHouseNo,
    moo: c.regMoo,
    soi: c.regSoi,
    road: c.regRoad,
    subdistrict: c.regSubdistrict,
    district: c.regDistrict,
    province: c.regProvince,
    postalCode: c.regPostalCode,
    country: c.regCountry,
  });
  return (
    <div className="mt-3 rounded border border-gray-400 p-2">
      <div className="text-gray-600">ผู้ขาย/Vendor</div>
      <div className="font-semibold">
        {c.code} {c.name}
      </div>
      {address && <div>{address}</div>}
      <div>{[c.taxId && `เลขประจำตัวผู้เสียภาษี ${c.taxId}`, c.branch, phone && `โทร ${phone}`].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

const Note = ({ text }: { text: string | null }) =>
  text ? (
    <div className="mt-3 break-inside-avoid">
      <div className="font-semibold">หมายเหตุ</div>
      <div className="whitespace-pre-line">{text}</div>
    </div>
  ) : null;

export default async function PurchasePrintPage({ params }: PageProps<"/print/purchase/[kind]/[id]">) {
  const { kind, id } = await params;
  if (!(kind in KINDS)) notFound();
  const k = KINDS[kind as keyof typeof KINDS];
  await requirePagePermission(k.menu, "view");
  const company = await getCompany();

  if (k.docType === "PR") {
    const d = await prisma.purchaseRequest.findUnique({
      where: { id },
      include: { requester: true, warehouse: true, lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } } },
    });
    if (!d) notFound();
    const approver = await lastApprover("PR", d.id);
    return (
      <PrintDocument
        company={company}
        titleTh={k.th}
        titleEn={k.en}
        docNo={d.docNo}
        meta={[
          { label: "วันที่/Date", value: formatDate(d.docDate) },
          { label: "ต้องการภายใน", value: formatDate(d.requiredDate) || "-" },
        ]}
        backHref={`${k.back}/${d.id}`}
        cancelled={d.status === "CANCELLED"}
      >
        <InfoGrid
          items={[
            { label: "ผู้ขอ", value: fullName(d.requester) },
            { label: "แผนก", value: d.department },
            { label: "ตำแหน่ง", value: d.position },
            { label: "คลังปลายทาง", value: d.warehouse?.name },
            { label: "เอกสารอ้างอิง", value: d.reference },
          ]}
        />
        <PrintTable
          head={[
            { label: "ลำดับ", className: "w-10 text-center" },
            { label: "รหัสสินค้า", className: "w-28" },
            { label: "รายการ" },
            { label: "จำนวน", className: "w-20 text-right" },
            { label: "หน่วย", className: "w-16 text-center" },
            { label: "หมายเหตุ", className: "w-40" },
          ]}
          rows={d.lines.map((l, i) => [i + 1, l.product.code, l.product.name, formatNumber(l.quantity.toString()), l.product.stockUnit?.name ?? "", l.note ?? ""])}
        />
        <Note text={d.note} />
        <Signatures
          items={[
            { role: "ผู้ขอซื้อ", name: fullName(d.requester), date: formatDate(d.docDate) },
            { role: "ผู้อนุมัติ", name: approver?.name, date: approver?.date },
          ]}
        />
      </PrintDocument>
    );
  }

  if (k.docType === "PO") {
    const d = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        createdBy: true,
        warehouse: true,
        lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } }, requestLine: { include: { request: { select: { docNo: true } } } } } },
      },
    });
    if (!d) notFound();
    const [approver, vendor] = await Promise.all([lastApprover("PO", d.id), vendorBlock(d.vendorId)]);
    const c = calcPurchaseOrder({
      lines: d.lines.map((l) => ({ quantity: l.quantity.toString(), unitPrice: l.unitPrice.toString(), discount: l.discount.toString() })),
      headerDiscount: d.headerDiscount.toString(),
      vatMode: d.vatMode,
      vatRate: d.vatRate.toString(),
    });
    const prs = [...new Set(d.lines.map((l) => l.requestLine?.request.docNo).filter(Boolean))].join(", ");
    const totalRow = (label: string, value: string, bold = false) => (
      <tr className={bold ? "font-bold" : undefined}>
        <td colSpan={6} className="border border-gray-400 px-1.5 py-1 text-right">
          {label}
        </td>
        <td className="border border-gray-400 px-1.5 py-1 text-right tabular-nums">{value}</td>
      </tr>
    );
    return (
      <PrintDocument
        company={company}
        titleTh={k.th}
        titleEn={k.en}
        docNo={d.docNo}
        meta={[
          { label: "วันที่/Date", value: formatDate(d.docDate) },
          { label: "วันที่ส่งของ", value: formatDate(d.deliveryDate) || "-" },
        ]}
        backHref={`${k.back}/${d.id}`}
        cancelled={d.status === "CANCELLED"}
      >
        {vendor}
        <InfoGrid
          items={[
            { label: "เงื่อนไขการชำระ", value: d.paymentTerms },
            { label: "คลังปลายทาง", value: d.warehouse?.name },
            { label: "อ้างอิงใบขอซื้อ", value: prs },
            { label: "เอกสารอ้างอิง", value: d.reference },
          ]}
        />
        <PrintTable
          head={[
            { label: "ลำดับ", className: "w-10 text-center" },
            { label: "รหัสสินค้า", className: "w-24" },
            { label: "รายการ" },
            { label: "จำนวน", className: "w-20 whitespace-nowrap text-right" },
            { label: "ราคา/หน่วย", className: "w-24 text-right" },
            { label: "ส่วนลด", className: "w-20 text-right" },
            { label: "จำนวนเงิน", className: "w-28 text-right" },
          ]}
          rows={d.lines.map((l, i) => [
            i + 1,
            l.product.code,
            l.product.name,
            `${formatNumber(l.quantity.toString())} ${l.product.stockUnit?.name ?? ""}`,
            formatMoney(l.unitPrice.toString()),
            Number(l.discount) ? formatMoney(l.discount.toString()) : "-",
            formatMoney(l.amount.toString()),
          ])}
          foot={
            <tfoot>
              {totalRow("รวมเป็นเงิน", formatMoney(c.subtotal))}
              {c.headerDiscount > 0 && totalRow("ส่วนลดท้ายบิล", formatMoney(c.headerDiscount))}
              {d.vatMode === "INCLUSIVE" && totalRow("มูลค่าก่อนภาษี", formatMoney(c.beforeVat))}
              {totalRow(d.vatMode === "NONE" ? VAT_MODE_LABELS.NONE : `ภาษีมูลค่าเพิ่ม ${Number(d.vatRate)}% (${VAT_MODE_LABELS[d.vatMode]})`, formatMoney(c.vatAmount))}
              {totalRow("ยอดรวมสุทธิ", formatMoney(c.total), true)}
            </tfoot>
          }
        />
        <Note text={d.note} />
        <Signatures
          items={[
            { role: "ผู้สั่งซื้อ", name: fullName(d.createdBy), date: formatDate(d.docDate) },
            { role: "ผู้อนุมัติ", name: approver?.name, date: approver?.date },
            { role: "ผู้ขาย", name: null, date: null },
          ]}
        />
      </PrintDocument>
    );
  }

  const d = await prisma.purchaseReturn.findUnique({
    where: { id },
    include: { createdBy: true, order: true, reason: true, lines: { orderBy: { lineNo: "asc" }, include: { product: { include: { stockUnit: true } } } } },
  });
  if (!d) notFound();
  const [approver, vendor] = await Promise.all([lastApprover("RT", d.id), vendorBlock(d.vendorId)]);
  return (
    <PrintDocument
      company={company}
      titleTh={k.th}
      titleEn={k.en}
      docNo={d.docNo}
      meta={[
        { label: "วันที่/Date", value: formatDate(d.docDate) },
        { label: "อ้างอิง PO", value: d.order.docNo },
      ]}
      backHref={`${k.back}/${d.id}`}
      cancelled={d.status === "CANCELLED"}
    >
      {vendor}
      <InfoGrid items={[{ label: "เหตุผลการคืน", value: d.reason.label }]} />
      <PrintTable
        head={[
          { label: "ลำดับ", className: "w-10 text-center" },
          { label: "รหัสสินค้า", className: "w-28" },
          { label: "รายการ" },
          { label: "จำนวนที่คืน", className: "w-24 text-right" },
          { label: "หน่วย", className: "w-16 text-center" },
          { label: "หมายเหตุ", className: "w-40" },
        ]}
        rows={d.lines.map((l, i) => [i + 1, l.product.code, l.product.name, formatNumber(l.quantity.toString()), l.product.stockUnit?.name ?? "", l.note ?? ""])}
      />
      <Note text={d.note} />
      <Signatures
        items={[
          { role: "ผู้ส่งคืน", name: fullName(d.createdBy), date: formatDate(d.docDate) },
          { role: "ผู้อนุมัติ", name: approver?.name, date: approver?.date },
          { role: "ผู้รับคืน (ผู้ขาย)", name: null, date: null },
        ]}
      />
    </PrintDocument>
  );
}
