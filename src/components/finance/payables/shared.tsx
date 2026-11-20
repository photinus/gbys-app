import { Badge, type BadgeTone } from "@/components/ui";
import type { BillKind, BillStatus } from "@/lib/dal/finance-bills";

export const STATUS_LABEL: Record<BillStatus, string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  approved: "Approved, unpaid",
  partially_paid: "Partly paid",
  paid: "Paid",
  rejected: "Sent back",
  void: "Void",
};

const STATUS_TONE: Record<BillStatus, BadgeTone> = {
  draft: "neutral",
  pending_approval: "warning",
  approved: "info",
  partially_paid: "info",
  paid: "success",
  rejected: "danger",
  void: "neutral",
};

export function BillStatusBadge({ status }: { status: BillStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function KindTag({ kind }: { kind: BillKind }) {
  return kind === "reimbursement" ? <Badge tone="info">Reimbursement</Badge> : null;
}

/** "reimbursement" claims read as "claim" to members. */
export const CLAIM_STATUS_LABEL: Record<BillStatus, string> = {
  draft: "Draft",
  pending_approval: "Waiting for review",
  approved: "Approved, payment coming",
  partially_paid: "Partly paid",
  paid: "Paid",
  rejected: "Not approved",
  void: "Withdrawn",
};

export function ClaimStatusBadge({ status }: { status: BillStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{CLAIM_STATUS_LABEL[status]}</Badge>;
}

/** Image types the browser can show inline. */
export function isPreviewable(contentType: string): boolean {
  return /^image\/(png|jpeg|webp)$/.test(contentType);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const ATTACHMENT_HREF = (id: string) => `/finance/payables/attachments/${id}`;
