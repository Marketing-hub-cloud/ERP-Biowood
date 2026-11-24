import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/session";
import { prisma } from "@/lib/db";
import { LabelSheet, type LabelData } from "./label-sheet";

export const metadata = { title: "พิมพ์ label" };

/** หน้าพิมพ์ label Barcode/SN ของใบนำเข้า (?line= เฉพาะรายการ, ?serial= เฉพาะ SN) */
export default async function LabelsPage({ params, searchParams }: PageProps<"/print/labels/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  await requirePagePermission("inventory.receipt", "view");
  const r = await prisma.goodsReceipt.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: { product: { include: { stockUnit: true } }, serials: { orderBy: { seq: "asc" } } },
      },
    },
  });
  if (!r) notFound();
  const line = typeof sp.line === "string" ? sp.line : null;
  const serial = typeof sp.serial === "string" ? sp.serial : null;

  const labels: LabelData[] = r.lines
    .filter((l) => !line || l.id === line)
    .flatMap((l) =>
      l.serials
        .filter((s) => !serial || s.id === serial)
        .map((s) => ({
          id: s.id,
          barcode: s.barcode,
          productCode: l.product.code,
          productName: l.product.name,
          qty: Number(s.initialQty),
          unit: l.product.stockUnit?.name ?? "",
          lot: r.lot,
        })),
    );

  return <LabelSheet docNo={r.docNo} cancelled={r.status === "CANCELLED"} labels={labels} backHref={`/inventory/receipts/${r.id}`} />;
}
