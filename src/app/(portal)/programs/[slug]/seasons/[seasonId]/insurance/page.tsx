import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { InsurancePlayersTable, InsuranceStaffTable } from "@/components/insurance/insurance-tables";
import { PrintButton } from "@/components/rosters/print-button";
import { Button, Card, Select, buttonStyles } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getInsuranceExport, listInsuranceTeams } from "@/lib/dal/insurance-export";
import { getBranding } from "@/lib/dal/settings";
import { formatDateTime, formatDob } from "@/lib/format";

export const metadata: Metadata = { title: "Insurance roster", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function InsuranceRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; seasonId: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const { slug, seasonId } = await params;
  const { team } = await searchParams;
  const ctx = await requireSession(`/programs/${slug}/seasons/${seasonId}/insurance`);

  let data, teamOptions;
  try {
    [data, teamOptions] = await Promise.all([
      getInsuranceExport(ctx, seasonId, { teamId: team || null, format: "print", expectedProgramSlug: slug }),
      listInsuranceTeams(ctx, seasonId),
    ]);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const branding = await getBranding();
  const base = `/programs/${slug}/seasons/${seasonId}`;
  const csvHref = `${base}/insurance/export${data.team ? `?team=${data.team.id}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 print:max-w-none print:space-y-3">
      <div className="space-y-3 print:hidden">
        <Link href={`/programs/${slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          ← {data.header.programName}
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Insurance roster</h1>
            <p className="mt-1 text-sm text-stone-500">
              Players and coaches for {data.header.seasonName}. Contains no medical information. Exporting is logged.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={csvHref} data-testid="insurance-csv" className={buttonStyles({ variant: "secondary" })}>
              <Download className="h-4 w-4" />
              Download CSV
            </a>
            <PrintButton />
          </div>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm font-semibold text-stone-600 sm:max-w-xs">
            Team
            <Select name="team" defaultValue={data.team?.id ?? ""} data-testid="insurance-team-filter">
              <option value="">All teams</option>
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </div>

      <header className="border-b border-line pb-3">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
          {branding.orgName} ({branding.legalDesignation})
        </h2>
        {branding.ein ? <p className="text-sm text-stone-600">EIN {branding.ein}</p> : null}
        <p className="mt-0.5 text-lg font-semibold text-stone-700">
          {data.header.programName} · {data.header.seasonName} roster
          {data.team ? ` · ${data.team.name}` : ""}
        </p>
        <p className="text-sm text-stone-600">
          {data.players.length} players · {data.staff.length} coaches and staff. Ages as of{" "}
          {formatDob(data.ageReferenceDate)} ({data.ageReferenceIsSeasonStart ? "season start" : "today"}).
        </p>
      </header>

      <Card className="print:border-0 print:p-0 print:shadow-none">
        <h2 className="mb-2 text-base font-bold">Players</h2>
        <InsurancePlayersTable data={data} />
      </Card>
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <h2 className="mb-2 text-base font-bold">Coaches and staff</h2>
        <InsuranceStaffTable data={data} />
      </Card>

      <footer className="border-t border-line pt-3 text-xs text-stone-500">
        Generated {formatDateTime(data.generatedAt)} (Pacific time) by {ctx.name}. Source: {branding.shortName} registrations and team rosters.
      </footer>
    </div>
  );
}
