import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryTable, MonthTable, ProgramTable, VolunteerTable, rateStatement } from "@/components/grants/breakdown-tables";
import { PrintButton } from "@/components/grants/print-button";
import { isBoard, requireSession } from "@/lib/dal/context";
import { getGrantReport, recordGrantExport } from "@/lib/dal/grants";
import { getBranding } from "@/lib/dal/settings";
import { listActivePrograms } from "@/lib/dal/programs";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import { parseGrantFilters } from "@/lib/validation/grants";
import { CATEGORY_LABELS, VERIFICATION_LABELS } from "@/lib/volunteer-categories";

export const metadata: Metadata = { title: "Grant summary" };
export const dynamic = "force-dynamic";

function ymdLabel(s: string) {
  return formatDate(new Date(`${s}T12:00:00Z`));
}

export default async function GrantPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSession("/admin/grants/print");
  if (!isBoard(ctx)) notFound();

  const parsed = parseGrantFilters(await searchParams);
  const { filters } = parsed;
  const [programs, report, branding] = await Promise.all([
    listActivePrograms(ctx),
    getGrantReport(ctx, filters, { audit: false }),
    getBranding(),
  ]);
  await recordGrantExport(ctx, filters, { format: "print", rowCount: report.totals.entries });

  const programLabel =
    filters.program === "all"
      ? "All programs and org-wide"
      : filters.program === "org"
        ? "Org-wide only"
        : (programs.find((p) => p.id === filters.program)?.name ?? "Selected program");
  const verificationLabel =
    filters.verification === "verified"
      ? "Verified only (shift check-in and admin approved)"
      : filters.verification === "all"
        ? "All entries, including pending self-reported"
        : `${VERIFICATION_LABELS[filters.verification]} only`;
  const categoryLabel = filters.categories.length
    ? filters.categories.map((c) => CATEGORY_LABELS[c]).join(", ")
    : "All categories";

  return (
    <div className="mx-auto max-w-4xl space-y-6 print:max-w-none print:space-y-5 print:text-[11px]">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-stone-500">Use your browser&apos;s print dialog and choose &ldquo;Save as PDF&rdquo;.</p>
        <PrintButton />
      </div>

      {!parsed.ok ? (
        <p role="alert" className="rounded-xl bg-coral/30 px-4 py-2.5 text-sm font-medium text-rose-950 print:hidden">
          {parsed.error} Showing the default range instead.
        </p>
      ) : null}

      <header className="border-b border-line pb-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {branding.orgName} ({branding.legalDesignation})
        </h1>
        {branding.ein ? <p className="text-sm text-stone-600">EIN {branding.ein}</p> : null}
        <p className="mt-0.5 text-lg font-semibold text-stone-700">In-kind volunteer hours summary</p>
        <p className="mt-1 text-sm text-stone-600">
          {ymdLabel(filters.from)} to {ymdLabel(filters.to)} (Pacific time, inclusive)
        </p>
      </header>

      <section className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <p><span className="font-semibold">Program:</span> {programLabel}</p>
        <p><span className="font-semibold">Verification:</span> {verificationLabel}</p>
        <p className="col-span-2"><span className="font-semibold">Categories:</span> {categoryLabel}</p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Volunteer hours", (report.totals.minutes / 60).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
          ["In-kind value", formatCents(report.totals.valueCents)],
          ["Volunteers", String(report.totals.volunteers)],
          ["Entries", String(report.totals.entries)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line p-3">
            <div className="text-xs font-medium text-stone-500">{label}</div>
            <div className="text-xl font-bold tabular-nums">{value}</div>
          </div>
        ))}
      </section>

      <p className="text-xs text-stone-600">{rateStatement(report)}</p>

      <section className="break-inside-avoid overflow-x-clip">
        <h2 className="mb-1 text-base font-bold">By category</h2>
        <CategoryTable report={report} />
      </section>
      <section className="break-inside-avoid overflow-x-clip">
        <h2 className="mb-1 text-base font-bold">By program</h2>
        <ProgramTable report={report} />
      </section>
      <section className="break-inside-avoid overflow-x-clip">
        <h2 className="mb-1 text-base font-bold">By month</h2>
        <MonthTable report={report} />
      </section>
      <section className="overflow-x-clip">
        <h2 className="mb-1 text-base font-bold">By volunteer</h2>
        <VolunteerTable report={report} />
      </section>

      <footer className="border-t border-line pt-3 text-xs text-stone-500">
        Generated {formatDateTime(new Date())} (Pacific time) by {ctx.name}. Source: {branding.shortName} volunteer ledger; deleted entries excluded.
      </footer>
    </div>
  );
}
