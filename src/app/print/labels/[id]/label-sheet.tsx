"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";

export type LabelData = { id: string; barcode: string; productCode: string; productName: string; qty: number; unit: string; lot: string | null };

type Size = { w: number; h: number };
const PRESETS: Record<string, Size> = { "50x30": { w: 50, h: 30 }, "40x25": { w: 40, h: 25 }, "60x40": { w: 60, h: 40 }, "100x50": { w: 100, h: 50 } };
const STORAGE_KEY = "label-size";
const clamp = (n: number) => Math.min(150, Math.max(20, Number.isFinite(n) ? n : 50));

/** ขนาด label จำไว้ในเครื่องนี้ (แต่ละเครื่องต่อเครื่องพิมพ์ต่างกัน) */
function loadSize(): Size {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (s && typeof s.w === "number" && typeof s.h === "number") return { w: clamp(s.w), h: clamp(s.h) };
  } catch {
    /* ไม่บังคับ */
  }
  return PRESETS["50x30"];
}

export function LabelSheet({ docNo, cancelled, labels, backHref }: { docNo: string; cancelled: boolean; labels: LabelData[]; backHref: string }) {
  const [size, setSize] = useState<Size>(PRESETS["50x30"]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- อ่านค่าที่จำไว้หลัง mount (กัน hydration ไม่ตรง)
    setSize(loadSize());
  }, []);
  const update = (s: Size) => {
    const next = { w: clamp(s.w), h: clamp(s.h) };
    setSize(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ไม่บังคับ */
    }
  };
  const preset = Object.entries(PRESETS).find(([, p]) => p.w === size.w && p.h === size.h)?.[0] ?? "custom";
  // ขนาดตัวอักษรตามความสูง label
  const base = size.h / 30;

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <style>{`
        @page { size: ${size.w}mm ${size.h}mm; margin: 0; }
        @media print {
          html, body { margin: 0 !important; padding: 0 !important; background: #fff; }
          .label-sheet { display: block !important; padding: 0 !important; gap: 0 !important; }
          .label { border: none !important; box-shadow: none !important; margin: 0 !important; break-after: page; page-break-after: always; }
          .label:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 border-b bg-background px-4 py-3 print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft /> ย้อนกลับ
          </Link>
        </Button>
        <div className="mr-auto">
          <p className="font-semibold">Label ใบนำเข้า {docNo}</p>
          <p className="text-xs text-muted-foreground">{formatNumber(labels.length)} label · Code128</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="labelPreset" className="text-xs">
            ขนาด label (มม.)
          </Label>
          <Select value={preset} onValueChange={(k) => k !== "custom" && update(PRESETS[k])}>
            <SelectTrigger id="labelPreset" size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(PRESETS).map((k) => (
                <SelectItem key={k} value={k}>
                  {k.replace("x", " × ")}
                </SelectItem>
              ))}
              <SelectItem value="custom">กำหนดเอง</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="labelW" className="text-xs">
            กว้าง
          </Label>
          <Input id="labelW" type="number" min={20} max={150} className="h-8 w-20" value={size.w} onChange={(e) => update({ ...size, w: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="labelH" className="text-xs">
            สูง
          </Label>
          <Input id="labelH" type="number" min={20} max={150} className="h-8 w-20" value={size.h} onChange={(e) => update({ ...size, h: Number(e.target.value) })} />
        </div>
        <Button onClick={() => window.print()} disabled={!labels.length}>
          <Printer /> พิมพ์
        </Button>
      </div>

      {cancelled && <p className="bg-destructive/10 px-4 py-2 text-sm text-destructive print:hidden">ใบนำเข้านี้ถูกยกเลิกแล้ว label เหล่านี้ใช้ไม่ได้</p>}
      {!labels.length && <p className="p-10 text-center text-muted-foreground">ยังไม่มี Barcode/SN</p>}

      <div className="label-sheet flex flex-wrap gap-3 p-4">
        {labels.map((l) => (
          <div
            key={l.id}
            className="label flex flex-col overflow-hidden border bg-white text-black shadow-sm"
            style={{ width: `${size.w}mm`, height: `${size.h}mm`, padding: `${1.5 * base}mm ${2 * base}mm`, fontSize: `${2.6 * base}mm`, lineHeight: 1.15 }}
            data-testid="label"
          >
            <div className="truncate font-bold">{l.productCode}</div>
            <div className="truncate" style={{ fontSize: "0.85em" }}>
              {l.productName}
            </div>
            <Barcode value={l.barcode} />
            <div className="text-center font-mono" style={{ fontSize: "0.8em" }}>
              {l.barcode}
            </div>
            <div className="flex justify-between gap-1" style={{ fontSize: "0.85em" }}>
              <span className="truncate">{l.lot ? `Lot ${l.lot}` : ""}</span>
              <span className="shrink-0 font-semibold">
                {formatNumber(l.qty)} {l.unit}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Code128 เป็น SVG ยืดเต็มความกว้าง label */
function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    // quiet zone ซ้าย/ขวา 10 module (width 2 → 20) ตามมาตรฐาน Code128 ให้สแกนติดง่าย
    JsBarcode(svg, value, { format: "CODE128", displayValue: false, margin: 0, marginLeft: 20, marginRight: 20, width: 2, height: 60 });
    const w = svg.getAttribute("width")?.replace("px", "");
    const h = svg.getAttribute("height")?.replace("px", "");
    if (w && h) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "none");
  }, [value]);
  return (
    <div className="my-[0.5mm] min-h-0 flex-1">
      <svg ref={ref} data-barcode={value} className="block h-full w-full" />
    </div>
  );
}
