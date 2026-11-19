import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { guard } from "@/components/finance/banking/guard";
import { StartReconciliationForm } from "@/components/finance/banking/reconcile-start";
import { dateOnly } from "@/components/finance/banking/shared";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, requireFinance } from "@/lib/dal/finance-access";
import { getReconcileOverview } from "@/lib/dal/finance-reconcile";
import { laToday } from "@/lib/finance/dates";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Reconcile" };
export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const ctx = await requireSession("/finance/banking/reconcile");
  const [{ accounts, history }, access] = await guard(async () => {
    const access = await requireFinance(ctx, "view_all");
    return [await getReconcileOverview(ctx), access] as const;
  });
  const canEdit = canEditBooks(access);
  const today = laToday();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Reconcile with your statement"
          description="Once a month, check your books against the bank statement. Pick the statement date and ending balance, tick off what cleared, and finish when the difference is $0.00."
        />
        {accounts.length === 0 ? (
          <EmptyState title="No bank accounts" description="Mark an account as a bank account in Accounts & funds first." />
        ) : (
          <div className="space-y-3">
            {accounts.map((a) => (
              <div key={a.id} className="space-y-3 rounded-2xl border border-line p-4" data-testid="rec-account">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-charcoal">{a.label}</p>
                    <p className="text-xs text-stone-500">
                      Books balance {formatCents(a.glBalanceCents)}
                      {a.lastCompleted ? ` · last reconciled through ${formatDate(dateOnly(a.lastCompleted.statementEndDate))}` : " · never reconciled"}
                    </p>
                  </div>
                  {a.open ? <Badge tone="warning">In progress</Badge> : null}
                </div>
                {a.open ? (
                  <Link href={`/finance/banking/reconcile/${a.open.id}`} className={buttonStyles({ size: "sm" })} data-testid="rec-continue">
                    Continue (statement {formatDate(dateOnly(a.open.statementEndDate))})
                  </Link>
                ) : canEdit ? (
                  <StartReconciliationForm glAccountId={a.id} defaultDate={today} />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Past reconciliations" />
        {history.length === 0 ? (
          <EmptyState title="Nothing reconciled yet" />
        ) : (
          <Table className="min-w-[560px]">
            <THead>
              <tr>
                <TH>Statement date</TH>
                <TH>Account</TH>
                <TH className="text-right">Ending balance</TH>
                <TH>Finished</TH>
                <TH className="text-right">Report</TH>
              </tr>
            </THead>
            <TBody>
              {history.map((h) => (
                <TR key={h.id} data-testid="rec-history-row">
                  <TD className="whitespace-nowrap">{formatDate(dateOnly(h.statementEndDate))}</TD>
                  <TD>{h.accountLabel}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(h.endingBalanceCents)}</TD>
                  <TD className="whitespace-nowrap text-xs text-stone-500">
                    {h.completedAt ? formatDateTime(h.completedAt) : ""}
                    {h.completedByName ? ` · ${h.completedByName}` : ""}
                  </TD>
                  <TD className="text-right">
                    <Link href={`/finance/banking/reconcile/${h.id}`} className="text-xs font-semibold text-charcoal underline-offset-2 hover:underline">
                      View report
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
