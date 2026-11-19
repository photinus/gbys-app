import type { Metadata } from "next";
import Link from "next/link";
import { ReleaseFundsButton } from "@/components/finance/donations/release-funds";
import { fmtDay } from "@/components/finance/gl/format";
import { guarded } from "@/components/finance/gl/guard";
import { Badge, Card, CardHeader, EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { listFundReleases, listRestrictedFunds } from "@/lib/dal/finance-donations";
import { laToday } from "@/lib/finance/dates";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Restricted funds" };
export const dynamic = "force-dynamic";

export default async function FundsPage() {
  const ctx = await requireSession("/finance/donations/funds");
  const { funds, releases, canEdit } = await guarded(async () => ({
    funds: await listRestrictedFunds(ctx),
    releases: await listFundReleases(ctx),
    canEdit: canEditBooks(await getFinanceAccess(ctx)),
  }));
  const today = laToday();
  const totalRestricted = funds.reduce((s, f) => s + f.balanceCents, 0);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Donor-restricted funds"
          description={
            <>
              Money donors gave for a specific purpose. <strong>Still restricted</strong> total: <span data-testid="restricted-total">{formatCents(totalRestricted)}</span>
            </>
          }
        />
        <div className="mb-4 rounded-2xl bg-alabaster px-4 py-3 text-xs text-stone-600">
          Spending that you tag to a restricted fund is released automatically in the reports. Use <strong>Release funds</strong> when the purpose has been met some other way, for example you paid for the equipment from the General Fund and want to free up the donor&apos;s money.
        </div>
        {funds.length === 0 ? (
          <EmptyState title="No restricted funds yet" description="Create a donor-restricted fund under Accounts & funds, then choose it when you record a gift." action={<Link href="/finance/accounts" className="text-xs font-semibold text-indigo-900 hover:underline">Go to Accounts & funds</Link>} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Fund</TH>
                <TH className="text-right">Given</TH>
                <TH className="text-right">Spent</TH>
                <TH className="text-right">Released by hand</TH>
                <TH className="text-right">Still restricted</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {funds.map((f) => (
                <TR key={f.fundId} data-testid="fund-row">
                  <TD>
                    <span className="font-semibold">{f.name}</span>
                    {!f.isActive ? <Badge tone="neutral" className="ml-2">Inactive</Badge> : null}
                    {f.programName ? <span className="block text-xs text-stone-500">{f.programName}</span> : null}
                    {f.purpose ? <span className="block text-xs text-stone-500">{f.purpose}</span> : null}
                    {f.balanceCents < 0 ? <Badge tone="danger" className="mt-1">Overspent</Badge> : null}
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(f.raisedCents + f.otherCents)}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(f.spentCents)}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(f.releasedCents)}</TD>
                  <TD className="whitespace-nowrap text-right font-bold tabular-nums" data-testid="fund-balance">{formatCents(f.balanceCents)}</TD>
                  <TD className="text-right">
                    {canEdit && f.isActive ? <ReleaseFundsButton fundId={f.fundId} fundName={f.name} balanceCents={f.balanceCents} today={today} /> : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Release history" description="Each release is a journal entry. To undo one, void it in the journal." />
        {releases.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing has been released by hand yet.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Fund</TH>
                <TH className="text-right">Amount</TH>
                <TH>Reason</TH>
                <TH>By</TH>
              </tr>
            </THead>
            <TBody>
              {releases.map((r) => (
                <TR key={r.entryId} className={r.voided ? "opacity-50" : undefined} data-testid="release-row">
                  <TD className="whitespace-nowrap">
                    <Link href={`/finance/journal/${r.entryId}`} className="font-semibold text-indigo-900 hover:underline">
                      {fmtDay(r.date)}
                    </Link>
                    <span className="block text-xs text-stone-500">Entry #{r.entryNumber}</span>
                  </TD>
                  <TD>{r.fundName}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(r.amountCents)}</TD>
                  <TD>
                    {r.reason}
                    {r.voided ? <Badge tone="danger" className="ml-2">Voided</Badge> : null}
                  </TD>
                  <TD>{r.byName ?? ""}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
