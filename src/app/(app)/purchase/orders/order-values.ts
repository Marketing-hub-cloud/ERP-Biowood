// ค่าของฟอร์มใบสั่งซื้อ (ใช้ได้ทั้งหน้า server และฟอร์มฝั่ง client)
import type { VatMode } from "@/lib/purchase-calc";
import type { OpenRequestLine } from "@/server/purchase-requests";
import type { ContactOption } from "@/app/api/contact-options/route";

export type OrderLineValues = {
  key: string;
  productId: string;
  requestLineId: string | null;
  requestDocNo: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  note: string;
  received?: number;
  returned?: number;
};
export type OrderValues = {
  docDate: string;
  deliveryDate: string;
  vendor: ContactOption | null;
  paymentTerms: string;
  reference: string;
  warehouseId: string;
  note: string;
  vatMode: VatMode;
  headerDiscount: string;
  lines: OrderLineValues[];
};

let seq = 0;
const key = () => `n${++seq}`;

export const newOrderLine = (): OrderLineValues => ({ key: key(), productId: "", requestLineId: null, requestDocNo: null, quantity: "", unitPrice: "", discount: "", note: "" });

export function linesFromRequests(lines: OpenRequestLine[]): OrderLineValues[] {
  return lines.map((l) => ({
    key: key(),
    productId: l.productId,
    requestLineId: l.requestLineId,
    requestDocNo: l.requestDocNo,
    quantity: String(l.remaining),
    unitPrice: "",
    discount: "",
    note: "",
  }));
}
