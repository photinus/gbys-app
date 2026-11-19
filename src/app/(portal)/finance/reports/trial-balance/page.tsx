import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { PeriodControls, ReportFrame, exportHref, fmtIso, Amt } from "@/components/finance/reports/report-ui";
import { TrialBalanceTable } from "@/components/finance/reports/trial-balance-table";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/dal/context";
import { getTrialBalance } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Trial balance" };
export const dynamic = "force-dynamic";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/finance/reports/trial-balance");
  const q = toReportQuery(await searchParams);
  const r = await guard(getTrialBalance(ctx, q));
  const registerHref = (id: string) =>
    `/finance/reports/register?account=${id}&from=${r.meta.fy.from}&to=${r.asOf < r.meta.fy.to ? r.asOf : r.meta.fy.to}`;
  return (
    <ReportFrame
      title="Trial balance"
      subtitle="Every account’s balance on one date. Total debits must equal total credits."
      period={`As of ${fmtIso(r.asOf)}`}
      csvHref={exportHref("trial-balance", { asOf: r.asOf })}
      controls={<PeriodControls basePath="/finance/reports/trial-balance" meta={r.meta} mode="asof" asOf={r.asOf} />}
    >
      {!r.trial.balanced ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            <strong>Debits and credits do not match</strong> (off by{" "}
            <Amt cents={r.trial.totalDebits - r.trial.totalCredits} bold dash={false} symbol />). Ask your bookkeeper to look
            into it.
          </p>
        </div>
      ) : null}
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <TrialBalanceTable t={r.trial} registerHref={registerHref} />
        <p className="mt-4 text-xs text-stone-500">
          {r.trial.balanced ? "Debits equal credits." : "Debits and credits differ."} Revenue and expense accounts show everything
          since the books began, not just this fiscal year.
        </p>
      </Card>
    </ReportFrame>
  );
}
