import { Badge } from "@/components/ui";
import { TERM_WARNING_DAYS, type SeatTermStatus } from "@/lib/validation/board";

/** Term timeline badges: Current / Upcoming / Ended, "Term ends in N days" within 60 days, Non-voting. */
export function SeatBadges({
  status,
  daysLeft,
  isVotingDirector,
}: {
  status: SeatTermStatus;
  daysLeft: number | null;
  isVotingDirector: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={status === "current" ? "success" : status === "upcoming" ? "info" : "neutral"}>
        {status === "current" ? "Current" : status === "upcoming" ? "Upcoming" : "Ended"}
      </Badge>
      {status === "current" && daysLeft !== null && daysLeft <= TERM_WARNING_DAYS ? (
        <Badge tone="warning">{daysLeft <= 0 ? "Term ends today" : `Term ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}</Badge>
      ) : null}
      {!isVotingDirector ? <Badge>Non-voting</Badge> : null}
    </div>
  );
}
