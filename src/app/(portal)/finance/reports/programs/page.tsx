import type { Metadata } from "next";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { ProgramSummaryTable } from "@/components/finance/reports/program-summary-table";
import { PeriodControls, ReportFrame, exportHref, rangeText } from "@/components/finance/reports/report-ui";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/dal/context";
import { getProgramSummary } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Program summary" };
export const dynamic = "force-dynamic";

export default async function ProgramSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/finance/reports/programs");
  const q = toReportQuery(await searchParams);
  const r = await guard(getProgramSummary(ctx, q));
  return (
    <ReportFrame
      title="Program summary"
      subtitle="Revenue, expenses and surplus for each program. Lines not tied to a program are shown as organization-wide."
      period={rangeText(r.range.from, r.range.to)}
      csvHref={exportHref("programs", { from: r.range.from, to: r.range.to })}
      controls={<PeriodControls basePath="/finance/reports/programs" meta={r.meta} mode="range" from={r.range.from} to={r.range.to} />}
    >
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <ProgramSummaryTable s={r.summary} />
        <p className="mt-4 text-xs text-stone-500">
          Includes restricted and unrestricted funds. Spending from restricted funds counts as an expense of its program.
        </p>
      </Card>
    </ReportFrame>
  );
}
