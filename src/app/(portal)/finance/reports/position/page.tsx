import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { PositionTable } from "@/components/finance/reports/position-table";
import { PeriodControls, ReportFrame, exportHref, fmtIso, Amt } from "@/components/finance/reports/report-ui";
import { Card } from "@/components/ui/card";
import { requireSession } from "@/lib/dal/context";
import { getFinancialPosition } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Statement of financial position" };
export const dynamic = "force-dynamic";

export default async function PositionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/finance/reports/position");
  const q = toReportQuery(await searchParams);
  const r = await guard(getFinancialPosition(ctx, q));
  return (
    <ReportFrame
      title="Statement of financial position"
      subtitle="What the organization owns (assets), owes (liabilities) and has left over (net assets) on one date."
      period={`As of ${fmtIso(r.asOf)}`}
      csvHref={exportHref("position", { asOf: r.asOf })}
      controls={<PeriodControls basePath="/finance/reports/position" meta={r.meta} mode="asof" asOf={r.asOf} />}
    >
      {!r.position.balanced ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            <strong>This statement does not balance.</strong> Assets are off from liabilities plus net assets by{" "}
            <Amt cents={r.position.difference} bold dash={false} symbol />. Please check the trial balance and recent journal
            entries, or ask your bookkeeper.
          </p>
        </div>
      ) : null}
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <p className="mb-4 text-sm font-semibold text-stone-600 print:hidden">As of {fmtIso(r.asOf)}</p>
        <PositionTable p={r.position} />
        <p className="mt-4 text-xs text-stone-500">
          {r.position.balanced
            ? "Balance check: assets equal liabilities plus net assets."
            : "Balance check failed (see the warning above)."}{" "}
          Net assets are computed from posted entries: opening balances plus all revenue minus expenses to date, with
          donor-restricted money kept separate.
        </p>
      </Card>
    </ReportFrame>
  );
}
