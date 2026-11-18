import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuditFilterForm } from "@/components/admin/audit-filter-form";
import { AuditLogList } from "@/components/admin/audit-log-list";
import { Card, CardHeader } from "@/components/ui/card";
import { listAuditFilterOptions, listAuditLog } from "@/lib/dal/audit-log";
import { isBoard, requireSession } from "@/lib/dal/context";
import { auditFiltersToQuery, parseAuditFilters } from "@/lib/validation/audit-log";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/admin/audit");
  if (!isBoard(ctx)) notFound();

  const parsed = parseAuditFilters(await searchParams);
  const { filters } = parsed;
  // First-page load only: this call records the single `audit.viewed` row for the visit.
  const [page, options] = await Promise.all([listAuditLog(ctx, filters), listAuditFilterOptions(ctx)]);
  const query = auditFiltersToQuery(filters).toString();
  const filtered = query !== "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Audit log</h1>
        <p className="mt-1 text-sm text-stone-500">
          Who did what, newest first. Viewing this page is itself recorded. Times are Pacific.
        </p>
      </div>

      <Card>
        <CardHeader title="Filters" description="Dates are inclusive Pacific-time calendar days" />
        {!parsed.ok ? (
          <p role="alert" className="mb-4 rounded-xl bg-coral/30 px-4 py-2.5 text-sm font-medium text-rose-950">
            {parsed.error} Showing everything instead.
          </p>
        ) : null}
        <AuditFilterForm filters={filters} actions={options.actions} targetTypes={options.targetTypes} />
      </Card>

      <Card>
        <CardHeader
          title={filtered ? "Matching entries" : "All entries"}
          description="Open a row's arrow to see its full metadata"
        />
        {/* key: a new filter set remounts the list so "load more" state never leaks across filters */}
        <AuditLogList key={query} initialRows={page.rows} initialCursor={page.nextCursor} query={query} />
      </Card>
    </div>
  );
}
