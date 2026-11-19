import { Badge } from "@/components/ui";
import type { EventBookingStatus } from "@/lib/dal/team-schedule";

/** Facility booking status next to an event. "none" (away / off-site) renders nothing. */
export function BookingBadge({ status, cancelled }: { status: EventBookingStatus; cancelled?: boolean }) {
  if (cancelled) return <Badge tone="neutral">Cancelled</Badge>;
  switch (status) {
    case "requested":
      return <Badge tone="warning">Requested</Badge>;
    case "approved":
      return <Badge tone="success">Confirmed</Badge>;
    case "declined":
      return <Badge tone="danger">Declined</Badge>;
    case "cancelled":
      return <Badge tone="neutral">Facility cancelled</Badge>;
    default:
      return null;
  }
}
