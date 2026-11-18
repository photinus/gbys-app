import { Badge, type BadgeTone } from "@/components/ui/badge";
import { daysUntil } from "@/lib/format";

export type CredentialStatusValue = "pending_review" | "verified" | "expired" | "rejected";
export type DisplayStatus = "pending_review" | "verified" | "expiring" | "expired" | "rejected";

export const EXPIRING_SOON_DAYS = 30;

/** Effective status: a verified credential past (or near) its expiry is shown as expired (expiring soon). */
export function getDisplayStatus(
  status: CredentialStatusValue,
  expiresAt: Date | string | null,
): DisplayStatus {
  if (status === "verified" && expiresAt) {
    const d = daysUntil(expiresAt);
    if (d < 0) return "expired";
    if (d <= EXPIRING_SOON_DAYS) return "expiring";
  }
  return status;
}

const DISPLAY: Record<DisplayStatus, { label: string; tone: BadgeTone }> = {
  pending_review: { label: "Pending Review", tone: "info" },
  verified: { label: "Verified", tone: "success" },
  expiring: { label: "Expiring Soon", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  rejected: { label: "Rejected", tone: "danger" },
};

export function CredentialStatusBadge({
  status,
  expiresAt,
}: {
  status: CredentialStatusValue;
  expiresAt: Date | string | null;
}) {
  const d = DISPLAY[getDisplayStatus(status, expiresAt)];
  return <Badge tone={d.tone}>{d.label}</Badge>;
}
