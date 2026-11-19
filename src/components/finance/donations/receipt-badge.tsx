import { Badge } from "@/components/ui";
import { receiptStatusLabel, type ReceiptStatus } from "@/lib/finance/receipt-content";
import { formatDate } from "@/lib/format";

/** "Not sent" / "Emailed Nov 3" / "Printed Nov 3" / "Out of date", plus a "Required" flag for gifts of $250 or more. */
export function ReceiptBadge({ status, className }: { status: ReceiptStatus; className?: string }) {
  if (status.kind === "none") return <span className="text-xs text-stone-400">No receipt needed</span>;
  const label = receiptStatusLabel(status, (iso) => formatDate(iso));
  const tone = status.outdated ? "warning" : status.kind === "not_sent" ? (status.required ? "danger" : "warning") : status.kind === "annual" ? "info" : "success";
  return (
    <span className={className}>
      <Badge tone={tone} data-testid="receipt-status">
        {label}
      </Badge>
      {status.required && status.needsReceipt ? (
        <Badge tone="danger" className="ml-1.5" data-testid="receipt-required" title="Gifts of $250 or more must be acknowledged in writing (IRS rule)">
          Required
        </Badge>
      ) : null}
    </span>
  );
}
