import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { StripeActions, RetryPayoutButton } from "@/components/finance/stripe/stripe-actions";
import { DalError, requireSession } from "@/lib/dal/context";
import { getAutoPostStatus, PAYOUT_FEES_UNKNOWN } from "@/lib/dal/finance-autopost";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Stripe auto-posting" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  charge: "Card payment",
  refund: "Refund",
  dispute_opened: "Dispute opened",
  dispute_closed: "Dispute closed",
  offline_payment: "Offline payment",
  offline_void: "Offline void",
};

function payoutStatus(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case "paid":
      return { label: "Paid", tone: "success" };
    case PAYOUT_FEES_UNKNOWN:
      return { label: "Paid, fees missing", tone: "warning" };
    case "paid_pending":
      return { label: "Paid, not posted", tone: "warning" };
    case "in_transit":
      return { label: "In transit", tone: "info" };
    case "pending":
      return { label: "Pending", tone: "neutral" };
    case "failed":
      return { label: "Failed", tone: "danger" };
    case "canceled":
      return { label: "Canceled", tone: "neutral" };
    default:
      return { label: status, tone: "neutral" };
  }
}

function EntryLink({ id, number }: { id: string | null; number: number | null }) {
  if (!id) return <span className="text-stone-400">None</span>;
  return (
    <Link href={`/finance/journal/${id}`} className="font-medium text-indigo-700 underline-offset-2 hover:underline">
      #{number}
    </Link>
  );
}

export default async function FinanceStripePage() {
  const ctx = await requireSession("/finance/stripe");
  let s;
  try {
    s = await getAutoPostStatus(ctx);
  } catch (e) {
    if (e instanceof DalError && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND")) notFound();
    throw e;
  }
  const on = !!s.autoPostStartDate;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Stripe auto-posting</h1>
        <p className="mt-1 text-sm text-stone-500">
          Card and cash registration payments, Stripe fees and payouts flow into the books automatically. Partner league payments are not GBYS
          money; only the platform fee GBYS earns on them is posted.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Status"
          description="Payments post as they happen. A daily sweep picks up anything that was missed."
          action={s.canEdit ? <StripeActions autoPostOn={on} stripeEnabled={s.stripeEnabled} /> : undefined}
        />
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="autopost-status">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Auto-posting</dt>
            <dd className="mt-1 text-sm">
              {on ? <Badge tone="success">On since {formatDate(`${s.autoPostStartDate}T12:00:00`)}</Badge> : <Badge tone="warning">Off</Badge>}
            </dd>
            {!on ? <dd className="mt-1 text-xs text-stone-500">Set a start date in Finance settings.</dd> : null}
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Stripe</dt>
            <dd className="mt-1 text-sm">{s.stripeEnabled ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not configured</Badge>}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Last sweep</dt>
            <dd className="mt-1 text-sm text-charcoal">
              {s.lastSweep ? (
                <>
                  {formatDateTime(s.lastSweep.at)}
                  <span className="block text-xs text-stone-500">
                    {s.lastSweep.posted} posted, {s.lastSweep.skipped} skipped, {s.lastSweep.failed} failed
                  </span>
                </>
              ) : (
                <span className="text-stone-500">Not run yet</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Payouts land in</dt>
            <dd className="mt-1 text-sm text-charcoal">{s.payoutAccountName ?? "Not set"}</dd>
            {s.lockDate ? <dd className="mt-1 text-xs text-stone-500">Books closed through {formatDate(`${s.lockDate}T12:00:00`)}</dd> : null}
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader
          title="Waiting to post"
          description={on ? `${s.pendingCount} payment${s.pendingCount === 1 ? "" : "s"} not in the books yet.` : "Auto-posting is off, so nothing is waiting."}
        />
        {s.pending.length === 0 ? (
          <EmptyState title="Nothing waiting" description="Every eligible payment is in the books." />
        ) : (
          <Table className="min-w-[720px]">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Type</TH>
                <TH>Program</TH>
                <TH className="text-right">Amount</TH>
                <TH>Why not posted</TH>
              </tr>
            </THead>
            <TBody>
              {s.pending.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</TD>
                  <TD>{KIND_LABEL[r.kind] ?? r.kind}</TD>
                  <TD>{r.programName ?? "Unknown"}</TD>
                  <TD className="text-right tabular-nums">{formatCents(r.amountCents)}</TD>
                  <TD className="max-w-[320px] text-xs text-stone-600">{r.reason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {s.pendingCount > s.pending.length ? (
          <p className="mt-3 text-xs text-stone-500">Showing {s.pending.length} of {s.pendingCount}.</p>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Recent payouts" description="Each paid payout posts a bank deposit and the Stripe fees it carried. The bank feed matches the deposit." />
        {s.payouts.length === 0 ? (
          <EmptyState
            title="No payouts yet"
            description={s.stripeEnabled ? "Payouts appear here when Stripe sends payout events, or use Import recent payouts." : "Stripe is not configured on this server."}
          />
        ) : (
          <Table className="min-w-[860px]">
            <THead>
              <tr>
                <TH>Arrival</TH>
                <TH>Payout</TH>
                <TH>Status</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Fees</TH>
                <TH>Payout entry</TH>
                <TH>Fee entry</TH>
                <TH>Bank match</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {s.payouts.map((p) => {
                const st = payoutStatus(p.status);
                return (
                  <TR key={p.id} data-testid={`payout-${p.id}`}>
                    <TD className="whitespace-nowrap">{formatDate(`${p.arrivalDate}T12:00:00`)}</TD>
                    <TD className="font-mono text-xs">{p.id}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {p.needsAttention ? <p className="mt-1 max-w-[220px] text-xs text-amber-800">{p.needsAttention}</p> : null}
                    </TD>
                    <TD className="text-right tabular-nums">{formatCents(p.amountCents)}</TD>
                    <TD className="text-right tabular-nums">{formatCents(p.feesCents)}</TD>
                    <TD><EntryLink id={p.entryId} number={p.entryNumber} /></TD>
                    <TD><EntryLink id={p.feeEntryId} number={p.feeEntryNumber} /></TD>
                    <TD>
                      {p.entryId ? (
                        p.bankMatched ? <Badge tone="success">Matched</Badge> : <Badge tone="neutral">Not yet</Badge>
                      ) : (
                        <span className="text-stone-400">n/a</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      {s.canEdit && s.stripeEnabled && p.needsAttention ? <RetryPayoutButton payoutId={p.id} /> : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
