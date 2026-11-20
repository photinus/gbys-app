import { Badge, type BadgeTone } from "@/components/ui";
import { INVOICE_STATUS_LABELS } from "@/lib/validation/finance-invoices";

const TONE: Record<string, BadgeTone> = { draft: "neutral", open: "info", partially_paid: "warning", paid: "success", void: "neutral" };

export function InvoiceStatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={TONE[status] ?? "neutral"}>{INVOICE_STATUS_LABELS[status] ?? status}</Badge>
      {overdue ? <Badge tone="danger">Overdue</Badge> : null}
    </span>
  );
}
