import type { Metadata } from "next";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { RegisterTable } from "@/components/finance/reports/register-table";
import { PeriodControls, ReportFrame, exportHref, rangeText } from "@/components/finance/reports/report-ui";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { requireSession } from "@/lib/dal/context";
import { REGISTER_PAGE_LIMIT, getAccountRegister, getFilterOptions } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Account register" };
export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/finance/reports/register");
  const q = toReportQuery(await searchParams);
  const [r, options] = await guard(Promise.all([getAccountRegister(ctx, q), getFilterOptions(ctx)]));
  const label = r.account ? `${r.account.code} ${r.account.name}` : "Choose an account";
  return (
    <ReportFrame
      title="Account register"
      subtitle="Every line posted to one account in date order, with a running balance (the general ledger for that account)."
      period={`${label}, ${rangeText(r.range.from, r.range.to)}`}
      csvHref={
        r.account
          ? exportHref("register", { account: r.account.id, from: r.range.from, to: r.range.to, fund: q.fund })
          : undefined
      }
      controls={
        <PeriodControls
          basePath="/finance/reports/register"
          meta={r.meta}
          mode="range"
          from={r.range.from}
          to={r.range.to}
          keep={{ account: r.account?.id, fund: q.fund }}
        >
          <div className="sm:min-w-64">
            <Label htmlFor="rep-account">Account</Label>
            <Select id="rep-account" name="account" defaultValue={r.account?.id ?? ""} required>
              <option value="" disabled>
                Choose an account…
              </option>
              {r.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="rep-fund">Fund</Label>
            <Select id="rep-fund" name="fund" defaultValue={r.fundFilter ?? ""}>
              <option value="">All funds</option>
              {options.funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
        </PeriodControls>
      }
    >
      <Card className="print:border-0 print:p-0 print:shadow-none">
        {r.register && r.account ? (
          <>
            <h2 className="mb-4 text-lg font-bold">
              <span className="tabular-nums text-stone-400">{r.account.code}</span> {r.account.name}
            </h2>
            <RegisterTable reg={r.register} from={r.range.from} to={r.range.to} linkEntries={r.meta.canViewAll} />
            {r.truncated ? (
              <p className="mt-4 rounded-xl bg-amber-soft/30 p-3 text-sm text-amber-950">
                Showing the first {REGISTER_PAGE_LIMIT.toLocaleString("en-US")} lines. Narrow the dates or download the CSV for
                every line. Totals and the closing balance include everything in the period.
              </p>
            ) : null}
          </>
        ) : (
          <EmptyState title="Pick an account" description="Choose an account above and press Update report to see its lines." />
        )}
      </Card>
    </ReportFrame>
  );
}
