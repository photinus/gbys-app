import type { Metadata } from "next";
import { FunctionalTable } from "@/components/finance/reports/functional-table";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { PeriodControls, ReportFrame, exportHref, rangeText } from "@/components/finance/reports/report-ui";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/dal/context";
import { getFunctionalExpenses } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Functional expenses" };
export const dynamic = "force-dynamic";

export default async function FunctionalExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/finance/reports/functional-expenses");
  const q = toReportQuery(await searchParams);
  const r = await guard(getFunctionalExpenses(ctx, q));
  return (
    <ReportFrame
      title="Functional expenses"
      subtitle="Where the money went: program services, management & general, and fundraising. This is the breakdown the IRS Form 990 asks for."
      period={rangeText(r.range.from, r.range.to)}
      csvHref={exportHref("functional-expenses", { from: r.range.from, to: r.range.to })}
      controls={
        <PeriodControls basePath="/finance/reports/functional-expenses" meta={r.meta} mode="range" from={r.range.from} to={r.range.to} />
      }
    >
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <FunctionalTable f={r.functional} programNames={r.programNames} />
      </Card>
    </ReportFrame>
  );
}
