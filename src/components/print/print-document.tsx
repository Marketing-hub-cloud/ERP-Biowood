import type { ReactNode } from "react";
import { fileUrl } from "@/lib/storage";
import { PrintToolbar } from "./print-toolbar";

export type CompanyInfo = {
  nameTh: string;
  nameEn: string | null;
  address: string | null;
  taxId: string | null;
  branch: string | null;
  phone: string | null;
  email: string | null;
  logoKey: string | null;
};

/**
 * หน้าพิมพ์เอกสาร A4: โลโก้, ชื่อบริษัท, ที่อยู่, เลขผู้เสียภาษี (จาก ตั้งค่า > ข้อมูลบริษัท)
 * หัวเอกสารสองภาษา เช่น "ใบขอซื้อ/PurchaseRequest" และป้าย "(ต้นฉบับ/Original)"
 */
export function PrintDocument({
  company,
  titleTh,
  titleEn,
  docNo,
  meta,
  backHref,
  cancelled,
  children,
}: {
  company: CompanyInfo;
  titleTh: string;
  titleEn: string;
  docNo: string;
  /** ข้อมูลหัวขวา เช่น วันที่ */
  meta: { label: string; value: string }[];
  backHref: string;
  cancelled?: boolean;
  children: ReactNode;
}) {
  const logo = fileUrl(company.logoKey) ?? "/logo.png";
  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print { html, body { background: #fff !important; } .a4 { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; } }
      `}</style>
      <PrintToolbar backHref={backHref} title={`${titleTh} ${docNo}`} />
      <article className="a4 relative mx-auto my-6 w-[210mm] min-h-[297mm] bg-white p-[12mm] text-[12px] leading-snug text-black shadow" data-testid="print-document">
        {cancelled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-30 rounded border-4 border-red-500/60 px-6 py-2 text-6xl font-bold text-red-500/50">ยกเลิก</span>
          </div>
        )}
        <header className="flex items-start gap-4 border-b pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="" className="h-14 w-auto max-w-[45mm] object-contain" />
          <div className="flex-1">
            <div className="text-[15px] font-bold">{company.nameTh || "(ยังไม่ได้ตั้งค่าข้อมูลบริษัท)"}</div>
            {company.nameEn && <div className="font-semibold">{company.nameEn}</div>}
            {company.address && <div className="whitespace-pre-line">{company.address}</div>}
            <div>{[company.taxId && `เลขประจำตัวผู้เสียภาษี ${company.taxId}`, company.branch].filter(Boolean).join(" · ")}</div>
            {(company.phone || company.email) && <div>{[company.phone && `โทร ${company.phone}`, company.email].filter(Boolean).join(" · ")}</div>}
          </div>
          <div className="w-[62mm] text-right">
            <div className="rounded border-2 border-black px-2 py-1.5 text-center">
              <div className="text-[15px] font-bold">
                {titleTh}/{titleEn}
              </div>
              <div>(ต้นฉบับ/Original)</div>
            </div>
            <table className="mt-2 ml-auto text-left">
              <tbody>
                <tr>
                  <td className="pr-2 text-gray-600">เลขที่/No.</td>
                  <td className="font-mono font-semibold">{docNo}</td>
                </tr>
                {meta.map((m) => (
                  <tr key={m.label}>
                    <td className="pr-2 text-gray-600">{m.label}</td>
                    <td>{m.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </header>
        {children}
      </article>
    </div>
  );
}

/** ตารางรายการในหน้าพิมพ์ */
export function PrintTable({ head, rows, foot }: { head: { label: string; className?: string }[]; rows: ReactNode[][]; foot?: ReactNode }) {
  return (
    <table className="mt-3 w-full border-collapse text-[11.5px]">
      <thead>
        <tr className="bg-gray-100">
          {head.map((h) => (
            <th key={h.label} className={`border border-gray-400 px-1.5 py-1 font-semibold ${h.className ?? ""}`}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="break-inside-avoid">
            {r.map((c, j) => (
              <td key={j} className={`border border-gray-400 px-1.5 py-1 align-top ${head[j]?.className ?? ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot}
    </table>
  );
}

export function InfoGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1">
      {items.map((it) => (
        <div key={it.label} className="flex gap-2">
          <dt className="w-32 shrink-0 text-gray-600">{it.label}</dt>
          <dd className="flex-1">{it.value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** ช่องเซ็นชื่อท้ายเอกสาร */
export function Signatures({ items }: { items: { role: string; name?: string | null; date?: string | null }[] }) {
  return (
    <div className="mt-10 grid break-inside-avoid gap-6" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((s) => (
        <div key={s.role} className="text-center">
          <div className="mx-auto mb-1 h-10 w-4/5 border-b border-dotted border-gray-500" />
          <div>({s.name || "..............................."})</div>
          <div className="font-semibold">{s.role}</div>
          <div className="text-gray-600">วันที่ {s.date || "......../......../........"}</div>
        </div>
      ))}
    </div>
  );
}
