import type { Metadata } from "next";
import { ActivitiesTable } from "@/components/finance/reports/activities-table";
import { guard, toReportQuery } from "@/components/finance/reports/page-helpers";
import { PeriodControls, ReportFrame, exportHref, rangeText } from "@/components/finance/reports/report-ui";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { requireSession } from "@/lib/dal/context";
import { getFilterOptions, getStatementOfActivities } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Statement of activities" };
export const dynamic = "force-dynamic";

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/finance/reports/activities");
  const q = toReportQuery(await searchParams);
  const [r, options] = await guard(Promise.all([getStatementOfActivities(ctx, q), getFilterOptions(ctx)]));
  const programValue = r.programFilter === null ? "org" : (r.programFilter ?? "");
  return (
    <ReportFrame
      title="Statement of activities"
      subtitle="Revenue, expenses and the change in net assets for the period, split by whether donors restricted the money."
      period={rangeText(r.range.from, r.range.to)}
      csvHref={exportHref("activities", { from: r.range.from, to: r.range.to, program: q.program, fund: q.fund })}
      controls={
        <PeriodControls
          basePath="/finance/reports/activities"
          meta={r.meta}
          mode="range"
          from={r.range.from}
          to={r.range.to}
          keep={{ program: q.program, fund: q.fund }}
        >
          <div>
            <Label htmlFor="rep-program">Program</Label>
            <Select id="rep-program" name="program" defaultValue={programValue}>
              <option value="">All programs</option>
              {options.allowOrgWide ? <option value="org">Organization-wide only</option> : null}
              {options.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
                  {f.restricted ? " (restricted)" : ""}
                </option>
              ))}
            </Select>
          </div>
        </PeriodControls>
      }
    >
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <p className="mb-4 text-sm font-semibold text-stone-600 print:hidden">{rangeText(r.range.from, r.range.to)}</p>
        <ActivitiesTable a={r.activities} netAssets={r.netAssets} />
        <p className="mt-4 text-xs text-stone-500">
          Spending from a donor-restricted fund is shown as an expense without restrictions, with an equal “released from
          restrictions” amount moving from the restricted column. {r.netAssets ? "" : "Net assets balances are shown only for the whole organization with no filters."}
        </p>
      </Card>
    </ReportFrame>
  );
}
