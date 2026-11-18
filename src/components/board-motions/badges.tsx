import { Badge, type BadgeTone } from "@/components/ui";
import { KIND_LABELS, STATUS_LABELS, type MotionKind, type MotionStatus } from "@/lib/validation/board-motions";

const TONES: Record<MotionStatus, BadgeTone> = {
  draft: "neutral",
  open: "info",
  passed: "success",
  failed: "danger",
  withdrawn: "neutral",
};

export function MotionStatusBadge({ status }: { status: MotionStatus }) {
  return <Badge tone={TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function MotionKindBadge({ kind }: { kind: MotionKind }) {
  return <Badge tone={kind === "without_meeting" ? "warning" : "neutral"}>{KIND_LABELS[kind]}</Badge>;
}
