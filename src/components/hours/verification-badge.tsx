import { Badge, type BadgeTone } from "@/components/ui/badge";
import { VERIFICATION_LABELS, type VerificationMethod } from "@/lib/volunteer-categories";

const TONES: Record<VerificationMethod, BadgeTone> = {
  self_reported: "warning",
  shift_checkin: "success",
  admin_approved: "success",
};

export function VerificationBadge({ method }: { method: VerificationMethod }) {
  return <Badge tone={TONES[method]}>{VERIFICATION_LABELS[method]}</Badge>;
}
