import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtDay, money } from "@/components/finance/gl/format";
import { ApprovalsPanel } from "@/components/finance/payables/approvals-panel";
import { AttachmentsPanel } from "@/components/finance/payables/attachments-panel";
import { ClaimStatusBadge } from "@/components/finance/payables/shared";
import { WithdrawClaimButton } from "@/components/finance/payables/withdraw-claim-button";
import { Card, CardHeader, buttonStyles } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getMyReimbursement } from "@/lib/dal/finance-bills";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/finance-bills";

export const metadata: Metadata = { title: "Reimbursement claim" };
export const dynamic = "force-dynamic";

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/reimbursements/${id}`);
  let claim;
  try {
    claim = await getMyReimbursement(ctx, id);
  } catch (e) {
    if (e instanceof DalError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const paid = claim.payments.filter((p) => !p.voidedAt);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/reimbursements" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Reimbursements</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl" data-testid="claim-title">{claim.memo}</h1>
            <p className="mt-1 text-sm text-stone-500">
              {money(claim.totalCents)} · paid on {fmtDay(claim.billDate)}
              {claim.programName ? ` · ${claim.programName}` : ""}
            </p>
            <div className="mt-2">
              <ClaimStatusBadge status={claim.status} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {claim.viewer.canWithdraw ? <WithdrawClaimButton claimId={claim.id} /> : null}
            {claim.status === "rejected" ? (
              <Link href="/reimbursements/new" className={buttonStyles({ size: "sm" })}>
                Send a new claim
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {paid.length > 0 ? (
        <Card>
          <CardHeader title="Payment" />
          <ul className="space-y-2 text-sm" data-testid="claim-payments">
            {paid.map((p) => (
              <li key={p.paymentId} className="flex items-baseline justify-between gap-3">
                <span>
                  Paid {fmtDay(p.paymentDate)} by {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}
                  {p.reference ? ` (${p.reference})` : ""}
                </span>
                <span className="font-semibold tabular-nums">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Items" />
          <ul className="divide-y divide-line-soft text-sm">
            {claim.lines.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="min-w-0 break-words">{l.description || "Item"}</span>
                <span className="shrink-0 tabular-nums">{money(l.amountCents)}</span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3 py-2.5 font-bold">
              <span>Total</span>
              <span className="tabular-nums">{money(claim.totalCents)}</span>
            </li>
          </ul>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Review" />
          <ApprovalsPanel bill={claim} claimView />
        </Card>
      </div>

      <Card>
        <CardHeader title="Receipts" />
        <AttachmentsPanel billId={claim.id} attachments={claim.attachments} canChange={claim.viewer.canAttach} claimant label="Receipts" />
      </Card>
    </div>
  );
}
