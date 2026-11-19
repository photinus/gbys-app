import { Badge, type BadgeTone } from "@/components/ui";
import { SUBMISSION_STATUS_LABELS, type SubmissionStatus } from "@/lib/validation/contact-forms";

const TONES: Record<SubmissionStatus, BadgeTone> = { new: "info", read: "neutral", archived: "neutral", spam: "danger" };

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  return <Badge tone={TONES[status]}>{SUBMISSION_STATUS_LABELS[status]}</Badge>;
}
