import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { FundBalancesTable } from "@/components/finance/reports/fund-balances-table";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { PeriodControls, ReportFrame, exportHref, rangeText } from "@/components/finance/reports/report-ui";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/dal/context";
import { getFundBalances } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Fund balances" };
export const dynamic = "force-dynamic";

export default async function FundBalancesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/finance/reports/fund-balances");
  const q = toReportQuery(await searchParams);
  const r = await guard(getFundBalances(ctx, q));
  return (
    <ReportFrame
      title="Fund balances"
      subtitle="Each fund’s opening balance, money received, money spent and closing balance. Donor-restricted funds can only be spent on their purpose."
      period={rangeText(r.range.from, r.range.to)}
      csvHref={exportHref("fund-balances", { from: r.range.from, to: r.range.to })}
      controls={
        <PeriodControls basePath="/finance/reports/fund-balances" meta={r.meta} mode="range" from={r.range.from} to={r.range.to} />
      }
    >
      {r.balances.anyNegative ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            <strong>A fund has a negative balance.</strong> More has been spent from it than it received. For a
            donor-restricted fund, move the extra spending to another fund or fix the entry.
          </p>
        </div>
      ) : null}
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <FundBalancesTable b={r.balances} programNames={r.programNames} />
        <p className="mt-4 text-xs text-stone-500">
          Balance = money received + opening balances − money spent from the fund.
          {r.meta.canViewAll ? "" : " You see only the funds tied to your programs."}
        </p>
      </Card>
    </ReportFrame>
  );
}
