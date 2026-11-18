import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryTable, MonthTable, ProgramTable, VolunteerTable, rateStatement } from "@/components/grants/breakdown-tables";
import { GrantFilterForm } from "@/components/grants/grant-filter-form";
import { GrantKpis } from "@/components/grants/grant-kpis";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { isBoard, requireSession } from "@/lib/dal/context";
import { getGrantReport } from "@/lib/dal/grants";
import { listActivePrograms } from "@/lib/dal/programs";
import { grantFiltersToQuery, parseGrantFilters } from "@/lib/validation/grants";

export const metadata: Metadata = { title: "Grant reports" };
export const dynamic = "force-dynamic";

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/admin/grants");
  if (!isBoard(ctx)) notFound();

  const parsed = parseGrantFilters(await searchParams);
  const { filters } = parsed;
  const [programs, report] = await Promise.all([listActivePrograms(ctx), getGrantReport(ctx, filters)]);
  const query = grantFiltersToQuery(filters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Grant reports</h1>
        <p className="mt-1 text-sm text-stone-500">
          In-kind volunteer hours from the ledger. Deleted entries are always excluded; pending self-reported hours are excluded by default.
        </p>
      </div>

      <Card>
        <CardHeader title="Filters" description="Dates are inclusive Pacific-time calendar days" />
        {!parsed.ok ? (
          <p role="alert" className="mb-4 rounded-xl bg-coral/30 px-4 py-2.5 text-sm font-medium text-rose-950">
            {parsed.error} Showing the default range instead.
          </p>
        ) : null}
        <GrantFilterForm filters={filters} programs={programs.map((p) => ({ id: p.id, name: p.name }))} />
      </Card>

      <GrantKpis totals={report.totals} />

      <div className="flex flex-wrap items-center gap-2">
        {/* Plain anchors: the export is a file download, the print view opens in a new tab. */}
        <a href={`/admin/grants/export?${query}`} className={buttonStyles({ variant: "primary" })}>
          Export CSV
        </a>
        <a href={`/admin/grants/print?${query}`} target="_blank" rel="noopener" className={buttonStyles({ variant: "secondary" })}>
          Printable summary
        </a>
        <p className="w-full text-xs text-stone-500 sm:ml-2 sm:w-auto">{rateStatement(report)}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="By category" />
          <CategoryTable report={report} />
        </Card>
        <Card>
          <CardHeader title="By program" />
          <ProgramTable report={report} />
        </Card>
        <Card>
          <CardHeader title="By month" />
          <MonthTable report={report} />
        </Card>
        <Card>
          <CardHeader title="By volunteer" />
          <VolunteerTable report={report} />
        </Card>
      </div>
    </div>
  );
}
