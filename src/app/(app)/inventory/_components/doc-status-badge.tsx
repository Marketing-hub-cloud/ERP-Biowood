import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ISSUE_STATUS_LABELS, RECEIPT_STATUS_LABELS, type StockDocStatus } from "@/lib/stock-rules";

const CLASS: Record<StockDocStatus, string> = {
  DRAFT: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  POSTED: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  CANCELLED: "bg-muted text-muted-foreground line-through hover:bg-muted",
};

export function DocStatusBadge({ status, kind, className }: { status: StockDocStatus; kind: "receipt" | "issue"; className?: string }) {
  const label = (kind === "receipt" ? RECEIPT_STATUS_LABELS : ISSUE_STATUS_LABELS)[status];
  return <Badge className={cn(CLASS[status], className)}>{label}</Badge>;
}
