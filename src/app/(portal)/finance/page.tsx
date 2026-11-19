import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Circle, Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { Badge, Card, CardHeader, EmptyState, KpiCard, TBody, TD, TH, THead, TR, Table, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess, isFinanceAdmin } from "@/lib/dal/finance-access";
import { getFinanceOverview, type OrgOverview, type ProgramOverview } from "@/lib/dal/finance-overview";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

export default async function FinanceOverviewPage() {
  const ctx = await requireSession("/finance");
  const { overview, access } = await guarded(async () => ({
    overview: await getFinanceOverview(ctx),
    access: await getFinanceAccess(ctx),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Finance</h1>
        <p className="mt-1 text-sm text-stone-500">
          {overview.kind === "org"
            ? `Where the money stands. Fiscal year ${overview.fiscalYear.label} runs ${fmtDay(overview.fiscalYear.start)} to ${fmtDay(overview.fiscalYear.end)}.`
            : `Your programs' money for fiscal year ${overview.fiscalYear.label}.`}
        </p>
      </div>
      {overview.kind === "org" ? (
        <OrgView o={overview} canEdit={canEditBooks(access)} isAdmin={isFinanceAdmin(access)} />
      ) : (
        <ProgramView o={overview} />
      )}
    </div>
  );
}

function OrgView({ o, canEdit, isAdmin }: { o: OrgOverview; canEdit: boolean; isAdmin: boolean }) {
  const cash = o.banks.filter((b) => b.type === "asset").reduce((s, b) => s + b.bookCents, 0);
  const remaining = o.checklist.filter((c) => !c.done);
  const net = o.revenueCents - o.expenseCents;

  return (
    <>
      {canEdit && remaining.length > 0 ? (
        <Card data-testid="setup-checklist">
          <CardHeader title="Finish setting up" description={`${o.checklist.length - remaining.length} of ${o.checklist.length} done`} />
          <ul className="space-y-2.5">
            {o.checklist.map((c) => (
              <li key={c.key} className="flex items-start gap-3 text-sm">
                {c.done ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage/50 text-emerald-800">
                    <Check className="h-3 w-3" />
                  </span>
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-stone-300" />
                )}
                <div className="min-w-0">
                  <p className={cn("font-medium", c.done ? "text-stone-400 line-through" : "text-charcoal")}>{c.label}</p>
                  {!c.done ? (
                    <p className="text-xs text-stone-500">
                      {c.hint}{" "}
                      {c.href && (isAdmin || !c.href.startsWith("/finance/settings")) ? (
                        <Link href={c.href} className="font-semibold text-indigo-700 hover:underline">
                          Go there →
                        </Link>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {o.needsReviewCount > 0 ? (
        <Link
          href="/finance/banking"
          className="flex items-center justify-between gap-3 rounded-[24px] border border-amber-soft bg-amber-soft/30 px-5 py-4 hover:bg-amber-soft/45"
          data-testid="needs-review"
        >
          <span className="flex items-center gap-3 text-sm font-semibold text-amber-950">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            {o.needsReviewCount} bank transaction{o.needsReviewCount === 1 ? "" : "s"} need{o.needsReviewCount === 1 ? "s" : ""} review
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-amber-950" />
        </Link>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Landmark} tone="periwinkle" label="Cash in the bank" value={money(cash)} hint="According to our books" />
        <KpiCard icon={TrendingUp} tone="sage" label="Money in this year" value={money(o.revenueCents)} hint={`Fiscal year ${o.fiscalYear.label}`} />
        <KpiCard icon={TrendingDown} tone="coral" label="Money out this year" value={money(o.expenseCents)} hint={`Fiscal year ${o.fiscalYear.label}`} />
        <KpiCard
          icon={Wallet}
          tone="amber"
          label="Net this year"
          value={<span className={net < 0 ? "text-rose-700" : undefined}>{money(net)}</span>}
          hint="Money in minus money out"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Bank accounts" description="Books vs. what the bank reports" />
          {o.banks.length === 0 ? (
            <EmptyState title="No bank accounts yet" description="Add one under Accounts & funds." />
          ) : (
            <Table className="min-w-[420px]">
              <THead>
                <tr>
                  <TH>Account</TH>
                  <TH className="text-right">Our books</TH>
                  <TH className="text-right">Bank says</TH>
                </tr>
              </THead>
              <TBody>
                {o.banks.map((b) => (
                  <TR key={b.id} data-testid="bank-row">
                    <TD>
                      {b.name}
                      {b.type === "liability" ? <span className="block text-xs text-stone-400">Amount owed</span> : null}
                    </TD>
                    <TD className="text-right tabular-nums">{money(b.bookCents)}</TD>
                    <TD className="text-right tabular-nums">
                      {b.feeds.length ? (
                        b.feeds.map((f, i) => (
                          <span key={i} className="block">
                            {f.balanceCents === null ? "—" : money(f.balanceCents)}
                            <span className="block text-[11px] text-stone-400">
                              {f.lastSyncAt ? `Synced ${formatDateTime(f.lastSyncAt)}` : "Not synced yet"}
                            </span>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-stone-400">Not connected</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-sm">
            <div>
              <dt className="text-xs font-semibold text-stone-400">Stripe balance</dt>
              <dd className="tabular-nums text-charcoal" data-testid="stripe-balance">{money(o.stripeBalanceCents)}</dd>
              <dd className="text-[11px] text-stone-400">Card payments waiting to be paid out</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-stone-400">Undeposited funds</dt>
              <dd className="tabular-nums text-charcoal" data-testid="undeposited">{money(o.undepositedCents)}</dd>
              <dd className="text-[11px] text-stone-400">Cash and checks not yet banked</dd>
            </div>
          </dl>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Funds" description="Donor-restricted money is tracked separately" />
          {o.funds.length === 0 ? (
            <EmptyState title="No funds yet" />
          ) : (
            <ul className="divide-y divide-line-soft">
              {o.funds.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-3 text-sm" data-testid="fund-balance">
                  <span className="min-w-0">
                    <span className="font-medium text-charcoal">{f.name}</span>
                    <span className="block text-xs text-stone-500">
                      {f.restriction === "with_donor_restrictions" ? `Donor restricted${f.programName ? ` · ${f.programName}` : ""}` : "Unrestricted"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn("font-semibold tabular-nums", f.isNegative ? "text-rose-700" : "text-charcoal")}>{money(f.balanceCents)}</span>
                    {f.isNegative ? <Badge tone="danger" className="ml-2">Overspent</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Quick links" />
        <div className="flex flex-wrap gap-2.5">
          {canEdit ? (
            <Link href="/finance/journal/new" className={buttonStyles({ size: "sm" })}>New journal entry</Link>
          ) : null}
          <Link href="/finance/banking" className={buttonStyles({ variant: "secondary", size: "sm" })}>Bank inbox</Link>
          <Link href="/finance/journal" className={buttonStyles({ variant: "secondary", size: "sm" })}>Journal</Link>
          <Link href="/finance/reports" className={buttonStyles({ variant: "secondary", size: "sm" })}>Reports</Link>
          <Link href="/finance/accounts" className={buttonStyles({ variant: "secondary", size: "sm" })}>Accounts &amp; funds</Link>
        </div>
        <p className="mt-4 text-xs text-stone-500" data-testid="books-closed">
          {o.lockDate ? (
            <>Books are closed through <strong className="text-charcoal">{fmtDay(o.lockDate)}</strong>.</>
          ) : (
            "The books are open: no period has been closed."
          )}
          {isAdmin ? (
            <>
              {" "}
              <Link href="/finance/settings" className="font-semibold text-indigo-700 hover:underline">Finance settings</Link>
            </>
          ) : null}
        </p>
      </Card>
    </>
  );
}

function ProgramView({ o }: { o: ProgramOverview }) {
  return (
    <>
      <Card>
        <CardHeader
          title="Programs"
          description={`Fiscal year ${o.fiscalYear.label}`}
          action={<Link href="/finance/reports" className={buttonStyles({ size: "sm" })}>View reports</Link>}
        />
        {o.programs.length === 0 ? (
          <EmptyState title="No programs" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Program</TH>
                <TH className="text-right">Money in</TH>
                <TH className="text-right">Money out</TH>
                <TH className="text-right">Net</TH>
              </tr>
            </THead>
            <TBody>
              {o.programs.map((p) => (
                <TR key={p.id} data-testid="program-row">
                  <TD className="font-medium">{p.name}</TD>
                  <TD className="text-right tabular-nums">{money(p.revenueCents)}</TD>
                  <TD className="text-right tabular-nums">{money(p.expenseCents)}</TD>
                  <TD className="text-right font-semibold tabular-nums">{money(p.revenueCents - p.expenseCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {o.funds.length ? (
        <Card>
          <CardHeader title="Restricted funds" description="Donor-restricted money for your programs" />
          <ul className="divide-y divide-line-soft">
            {o.funds.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-charcoal">{f.name}</span>
                  <span className="block text-xs text-stone-500">{f.programName}</span>
                </span>
                <span className={cn("font-semibold tabular-nums", f.isNegative ? "text-rose-700" : "text-charcoal")}>{money(f.balanceCents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
