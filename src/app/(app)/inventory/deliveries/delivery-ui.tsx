import { Badge } from "@/components/ui/badge";
import { DELIVERY_STATUS_LABELS, type DeliveryStatus } from "@/lib/delivery";

export const DELIVERY_CLASS: Record<DeliveryStatus, string> = {
  SCHEDULED: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  DELIVERED: "bg-emerald-600 text-white hover:bg-emerald-600",
  CANCELLED: "bg-muted text-muted-foreground line-through hover:bg-muted",
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge className={DELIVERY_CLASS[status]}>{DELIVERY_STATUS_LABELS[status]}</Badge>;
}
