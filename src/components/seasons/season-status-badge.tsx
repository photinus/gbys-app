import { Badge, type BadgeTone } from "@/components/ui";
import { SEASON_STATUS_LABELS, type SeasonStatus } from "@/lib/validation/seasons";

const TONES: Record<SeasonStatus, BadgeTone> = {
  draft: "neutral",
  scheduled: "info",
  open: "success",
  closed: "warning",
  inactive: "neutral",
};

export function SeasonStatusBadge({ status }: { status: SeasonStatus }) {
  return <Badge tone={TONES[status]}>{SEASON_STATUS_LABELS[status]}</Badge>;
}
