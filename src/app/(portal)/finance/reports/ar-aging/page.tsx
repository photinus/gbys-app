import type { Metadata } from "next";
import { AgingCard, AgingTable } from "@/components/finance/receivables/aging-table";
import { guard } from "@/components/finance/reports/page-helpers";
import { PeriodControls, ReportFrame, fmtIso } from "@/components/finance/reports/report-ui";
import { requireSession } from "@/lib/dal/context";
import { getArAging } from "@/lib/dal/finance-invoices";
import { getReportMeta } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Invoices aging" };
export const dynamic = "force-dynamic";

export default async function ArAgingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/reports/ar-aging");
  const sp = await searchParams;
  const asOfRaw = Array.isArray(sp.asOf) ? sp.asOf[0] : sp.asOf;
  const [report, meta] = await guard(Promise.all([getArAging(ctx, asOfRaw), getReportMeta(ctx)]));
  return (
    <ReportFrame
      title="Invoices aging (A/R)"
      subtitle="Unpaid invoices grouped by how long they are past due. An invoice with no due date counts as due on its invoice date."
      period={`As of ${fmtIso(report.asOf)}`}
      csvHref={`/finance/reports/ar-aging/export?asOf=${report.asOf}`}
      controls={<PeriodControls basePath="/finance/reports/ar-aging" meta={meta} mode="asof" asOf={report.asOf} />}
    >
      <AgingCard>
        <p className="mb-4 text-sm font-semibold text-stone-600 print:hidden">As of {fmtIso(report.asOf)}</p>
        <AgingTable report={report} />
      </AgingCard>
    </ReportFrame>
  );
}
