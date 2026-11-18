import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { RosterRow } from "@/lib/dal/rosters";

const LABEL: Record<RosterRow["paymentStatus"], string> = {
  unpaid: "Unpaid",
  pending: "Pending",
  paid: "Paid",
  waived_scholarship: "Scholarship",
  refunded: "Refunded",
};
const TONE: Record<RosterRow["paymentStatus"], BadgeTone> = {
  unpaid: "warning",
  pending: "info",
  paid: "success",
  waived_scholarship: "info",
  refunded: "neutral",
};

export function PaymentBadge({ status }: { status: RosterRow["paymentStatus"] }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
