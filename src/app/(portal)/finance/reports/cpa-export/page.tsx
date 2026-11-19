import type { Metadata } from "next";
import { Download } from "lucide-react";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { Amt, PeriodControls, ReportFrame, exportHref, rangeText } from "@/components/finance/reports/report-ui";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/dal/context";
import { getCpaPreview } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "CPA export" };
export const dynamic = "force-dynamic";

export default async function CpaExportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/finance/reports/cpa-export");
  const q = toReportQuery(await searchParams);
  const r = await guard(getCpaPreview(ctx, q));
  const href = exportHref("cpa-export", { from: r.range.from, to: r.range.to });
  return (
    <ReportFrame
      title="CPA export"
      subtitle="A spreadsheet (CSV) of every journal line for the period, ready to hand to your accountant or tax preparer."
      period={rangeText(r.range.from, r.range.to)}
      csvHref={href}
      controls={<PeriodControls basePath="/finance/reports/cpa-export" meta={r.meta} mode="range" from={r.range.from} to={r.range.to} />}
    >
      <Card>
        <h2 className="text-lg font-bold">What is in the file</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Entries</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">{r.entryCount.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Lines</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">{r.lineCount.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Total debits</dt>
            <dd className="mt-1 text-xl">
              <Amt cents={r.debitCents} bold dash={false} symbol />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Total credits</dt>
            <dd className="mt-1 text-xl">
              <Amt cents={r.creditCents} bold dash={false} symbol />
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-stone-600">
          Columns: entry number, date, memo, source, account code, account name, fund, program, debit, credit and line
          description. Voided entries are left out.
        </p>
        <div className="mt-5 print:hidden">
          <a href={href} download className={buttonStyles({ variant: "primary" })}>
            <Download className="h-4 w-4" /> Download CSV
          </a>
        </div>
      </Card>
    </ReportFrame>
  );
}
