import type { Metadata } from "next";
import Link from "next/link";
import { AnnualBulkSend } from "@/components/finance/donations/bulk-send";
import { AnnualRowActions } from "@/components/finance/donations/annual-row-actions";
import { guarded } from "@/components/finance/gl/guard";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Label, Table, TBody, TD, TH, THead, TR, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { listAnnualStatements } from "@/lib/dal/finance-receipts";
import { laToday } from "@/lib/finance/dates";
import { formatCents, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Yearly statements" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function StatementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/donations/statements");
  const sp = await searchParams;
  const thisYear = Number(laToday().slice(0, 4));
  const y = Number(one(sp.year));
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : thisYear;
  const { s, canEdit } = await guarded(async () => ({ s: await listAnnualStatements(ctx, year), canEdit: canEditBooks(await getFinanceAccess(ctx)) }));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Yearly giving statements" description="One letter per donor listing every gift from a calendar year (January to December). Send these in January for tax season." />
        <div className="flex flex-wrap items-end gap-3">
          <form method="get" className="flex items-end gap-3">
            <div>
              <Label htmlFor="s-year">Year</Label>
              <Input id="s-year" type="number" name="year" min={2000} max={2100} defaultValue={year} className="w-28" data-testid="statement-year" />
            </div>
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[thisYear - 1, thisYear].map((yy) => (
              <Link key={yy} href={`/finance/donations/statements?year=${yy}`} className={buttonStyles({ variant: yy === year ? "primary" : "secondary", size: "sm" })}>
                {yy}
              </Link>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4" data-testid="statement-counts">
        <div className="rounded-2xl bg-white p-4 shadow-card border border-line/80">
          <p className="text-xs text-stone-500">Donors with gifts</p>
          <p className="text-2xl font-bold tabular-nums">{s.counts.donors}</p>
        </div>
        <div className="rounded-2xl bg-sage/25 p-4">
          <p className="text-xs text-stone-600">Ready to email</p>
          <p className="text-2xl font-bold tabular-nums" data-testid="count-emailable">{s.counts.emailable}</p>
        </div>
        <div className="rounded-2xl bg-amber-soft/30 p-4">
          <p className="text-xs text-stone-600">Need printing (no email)</p>
          <p className="text-2xl font-bold tabular-nums">{s.counts.noEmail}</p>
        </div>
        <div className="rounded-2xl bg-alabaster p-4">
          <p className="text-xs text-stone-600">Already sent</p>
          <p className="text-2xl font-bold tabular-nums">{s.counts.sent}</p>
        </div>
      </div>

      {s.rows.length > 0 ? (
        <div className="flex flex-wrap items-start gap-3">
          {canEdit ? <AnnualBulkSend year={year} emailable={s.counts.emailable} /> : null}
          <Link href={`/finance/donations/statements/print?year=${year}&filter=needing`} className={buttonStyles({ variant: "secondary", size: "md" })} data-testid="print-needing">
            Print the {s.counts.needing} still needed
          </Link>
          <Link href={`/finance/donations/statements/print?year=${year}&filter=all`} className={buttonStyles({ variant: "ghost", size: "md" })}>
            Print all {s.counts.donors}
          </Link>
        </div>
      ) : null}

      <Card>
        {s.rows.length === 0 ? (
          <EmptyState title={`No gifts in ${year}`} description="Pick another year, or record gifts first." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Donor</TH>
                <TH className="text-right">Gifts</TH>
                <TH className="text-right">Money given</TH>
                <TH className="text-right">Deductible</TH>
                <TH>Status</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {s.rows.map((r) => (
                <TR key={r.contactId} data-testid="statement-row">
                  <TD>
                    <Link href={`/finance/donations/donors/${r.contactId}`} className="font-semibold text-indigo-900 hover:underline">
                      {r.donorName}
                    </Link>
                    <span className="block text-xs text-stone-500">{r.email ?? "no email"}</span>
                  </TD>
                  <TD className="text-right tabular-nums">
                    {r.giftCount}
                    {r.inKindCount ? <span className="block text-xs text-stone-500">{r.inKindCount} in-kind</span> : null}
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(r.moneyCents)}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(r.deductibleCents)}</TD>
                  <TD>
                    {r.sent ? (
                      <Badge tone={r.outdated ? "warning" : "success"}>
                        {r.sent.method === "email" ? "Emailed" : r.sent.method === "mail" ? "Mailed" : "Printed"} {formatDate(r.sent.at)}
                        {r.outdated ? " · out of date" : ""}
                      </Badge>
                    ) : (
                      <Badge tone="warning">Not sent</Badge>
                    )}
                  </TD>
                  <TD className="text-right">
                    {canEdit ? (
                      <AnnualRowActions contactId={r.contactId} year={year} hasEmail={!!r.email} sent={!!r.sent} needs={r.needsStatement} />
                    ) : (
                      <Link href={`/finance/donations/statements/print?year=${year}&donor=${r.contactId}`} className="text-xs font-semibold text-indigo-900 hover:underline">
                        View
                      </Link>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-stone-500">Statements total money gifts only. In-kind gifts are listed without a value, as the IRS requires.</p>
      </Card>
    </div>
  );
}
