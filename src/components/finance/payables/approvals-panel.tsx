import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { BillDetail } from "@/lib/dal/finance-bills";
import { formatDateTime } from "@/lib/format";

/** Who approved or rejected, and what is still needed. Server component. */
export function ApprovalsPanel({ bill, claimView = false }: { bill: BillDetail; claimView?: boolean }) {
  const current = bill.approvals.filter((a) => a.current);
  const past = bill.approvals.filter((a) => !a.current);
  const approved = current.filter((a) => a.decision === "approve").length;
  const pending = bill.status === "pending_approval";
  const noun = claimView ? "claim" : "bill";

  return (
    <div className="space-y-3 text-sm" data-testid="approvals-panel">
      {bill.status === "draft" ? (
        <p className="text-stone-500">Not submitted yet.</p>
      ) : (
        <>
          {bill.submittedAt ? (
            <p className="text-stone-600">
              Submitted by <strong>{bill.submittedByName ?? "someone"}</strong> on {formatDateTime(bill.submittedAt)}.
              {pending
                ? bill.approvalsRequired > 1
                  ? ` It needs ${bill.approvalsRequired} different approvers because of the amount.`
                  : " It needs 1 approval."
                : ""}
            </p>
          ) : null}
          <ul className="space-y-2">
            {current.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5">
                {a.decision === "approve" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-charcoal">
                    {a.userName} {a.decision === "approve" ? "approved" : "sent it back"}
                    <span className="ml-2 text-xs font-normal text-stone-500">{formatDateTime(a.createdAt)}</span>
                  </p>
                  {a.note ? <p className="break-words text-stone-600">“{a.note}”</p> : null}
                </div>
              </li>
            ))}
            {pending && approved < bill.approvalsRequired
              ? Array.from({ length: bill.approvalsRequired - approved }).map((_, i) => (
                  <li key={`wait-${i}`} className="flex items-center gap-2.5 text-stone-500">
                    <Clock className="h-4 w-4 shrink-0" aria-hidden />
                    <span>Waiting for {approved + i === 0 ? "an" : "another"} approver</span>
                  </li>
                ))
              : null}
          </ul>
          {bill.status === "rejected" && bill.rejectedReason ? (
            <p className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-rose-900">
              <strong>Why it was sent back:</strong> {bill.rejectedReason}
            </p>
          ) : null}
          {past.length > 0 ? (
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer font-semibold">Earlier rounds ({past.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {past.map((a) => (
                  <li key={a.id}>
                    {a.userName} {a.decision === "approve" ? "approved" : "sent it back"} on {formatDateTime(a.createdAt)}
                    {a.note ? `: “${a.note}”` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {bill.status === "approved" || bill.status === "partially_paid" || bill.status === "paid" ? (
            <p className="text-xs text-stone-500">This {noun} is approved and on the books{bill.entryNumber ? ` (journal entry #${bill.entryNumber})` : ""}.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
