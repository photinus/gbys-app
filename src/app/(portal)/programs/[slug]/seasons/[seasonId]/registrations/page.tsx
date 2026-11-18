import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RosterKpiRow } from "@/components/rosters/roster-kpis";
import { RosterTable } from "@/components/rosters/roster-table";
import { DalError, requireSession } from "@/lib/dal/context";
import { listSeasonRegistrations } from "@/lib/dal/rosters";
import { formatCents } from "@/lib/format";
import { parseRosterFilter } from "@/lib/validation/rosters";

export const metadata: Metadata = { title: "Season Registrations" };

export default async function SeasonRegistrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; seasonId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { slug, seasonId } = await params;
  const { filter: rawFilter } = await searchParams;
  const path = `/programs/${slug}/seasons/${seasonId}/registrations`;
  const ctx = await requireSession(path);

  let roster;
  try {
    roster = await listSeasonRegistrations(ctx, seasonId, parseRosterFilter(rawFilter));
  } catch (e) {
    if (e instanceof DalError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  if (roster.header.programSlug !== slug) notFound();
  const { header } = roster;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href={`/programs/${slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
            ← {header.programName}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {header.seasonName} registrations
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            Fee {formatCents(header.feeCents)}. Families pay by cash or check; record it here.
          </p>
        </div>
        <Link
          href={`/programs/${slug}/seasons/${seasonId}/emergency`}
          className={buttonStyles({ variant: "secondary" })}
        >
          <ShieldAlert className="h-4 w-4" />
          Emergency sheet
        </Link>
      </div>

      <RosterKpiRow kpis={roster.kpis} />

      <Card>
        <RosterTable
          rows={roster.rows}
          filter={roster.filter}
          basePath={path}
          canManage={header.canManage}
          isBoard={header.isBoard}
        />
      </Card>
    </div>
  );
}
