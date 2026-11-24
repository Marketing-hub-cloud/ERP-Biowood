// ค่าของฟอร์มใบส่งคืน (ใช้ได้ทั้งหน้า server และฟอร์มฝั่ง client)
import type { ReturnableOrder } from "@/server/purchase-orders";

export type ReturnLineValues = {
  orderLineId: string;
  productCode: string;
  productName: string;
  unit: string;
  received: number;
  returnable: number;
  quantity: string;
  note: string;
  issued?: number;
};
export type ReturnValues = {
  docDate: string;
  orderId: string;
  orderDocNo: string;
  vendorName: string;
  reasonId: string | null;
  note: string;
  lines: ReturnLineValues[];
};
export type Reason = { id: string; label: string; isActive: boolean };

export function linesFromOrder(o: ReturnableOrder, current: Map<string, { quantity: string; note: string }> = new Map()): ReturnLineValues[] {
  return o.lines
    .filter((l) => l.returnable > 0 || current.has(l.orderLineId))
    .map((l) => ({
      orderLineId: l.orderLineId,
      productCode: l.productCode,
      productName: l.productName,
      unit: l.unit,
      received: l.received,
      returnable: l.returnable,
      quantity: current.get(l.orderLineId)?.quantity ?? "",
      note: current.get(l.orderLineId)?.note ?? "",
    }));
}
