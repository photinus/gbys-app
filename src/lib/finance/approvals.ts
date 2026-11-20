/**
 * Pure approval rules for bills and reimbursements (Finance 2, PB). No I/O.
 *
 *  - Separation of duties: the approver is never the bill's creator, its submitter,
 *    or the person being paid (a reimbursement's payee, or a vendor linked to a user).
 *  - At or above the dual-approval threshold two DIFFERENT approvers are needed.
 *  - One decision per approver per submission round; any rejection ends the round.
 */

export type ApprovalDecisionValue = "approve" | "reject";

export interface DecisionLike {
  userId: string;
  decision: ApprovalDecisionValue;
}

/** 1 approval, or 2 when the bill total is at or above the threshold (null/0 threshold = never dual). */
export function approvalsRequiredFor(totalCents: number, thresholdCents: number | null | undefined): 1 | 2 {
  if (thresholdCents && thresholdCents > 0 && totalCents >= thresholdCents) return 2;
  return 1;
}

export type ApproverRefusal = "creator" | "submitter" | "payee" | "already_decided";

export interface ApproverCheckInput {
  userId: string;
  creatorId: string;
  submitterId: string | null;
  /** Reimbursement payee (the member being paid back). */
  payeeUserId: string | null;
  /** The user linked to the vendor contact, if any. */
  contactUserId?: string | null;
  /** Users who already decided in this submission round. */
  decidedUserIds: readonly string[];
}

export const APPROVER_REFUSAL_TEXT: Record<ApproverRefusal, string> = {
  creator: "You created this, so someone else needs to approve it.",
  submitter: "You submitted this, so someone else needs to approve it.",
  payee: "You are the person being paid, so someone else needs to approve it.",
  already_decided: "You already decided on this one.",
};

/** null = allowed; otherwise why not. */
export function approverRefusal(i: ApproverCheckInput): ApproverRefusal | null {
  if (i.userId === i.creatorId) return "creator";
  if (i.submitterId && i.userId === i.submitterId) return "submitter";
  if ((i.payeeUserId && i.userId === i.payeeUserId) || (i.contactUserId && i.userId === i.contactUserId)) return "payee";
  if (i.decidedUserIds.includes(i.userId)) return "already_decided";
  return null;
}

export interface ApprovalTally {
  state: "pending" | "approved" | "rejected";
  approvals: number;
  required: number;
  /** Approvals still needed (0 when approved). */
  remaining: number;
}

/** Tally one submission round. Duplicate approvers count once. */
export function tallyApprovals(required: number, decisions: readonly DecisionLike[]): ApprovalTally {
  if (decisions.some((d) => d.decision === "reject")) {
    return { state: "rejected", approvals: 0, required, remaining: required };
  }
  const approvals = new Set(decisions.filter((d) => d.decision === "approve").map((d) => d.userId)).size;
  const done = approvals >= required;
  return { state: done ? "approved" : "pending", approvals, required, remaining: Math.max(required - approvals, 0) };
}
