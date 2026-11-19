import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CredentialReadiness } from "@/components/teams/credential-readiness";
import { RotateTokenButton } from "@/components/teams/rotate-token-button";
import { TeamColorDot } from "@/components/teams/team-color";
import { TeamRoster } from "@/components/teams/team-roster";
import { TeamTabs } from "@/components/teams/team-tabs";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { DalError, requireSession } from "@/lib/dal/context";
import { getTeamOverview } from "@/lib/dal/teams";
import { formatPhone } from "@/lib/validation/household";
import { TEAM_STAFF_ROLE_LABELS } from "@/lib/validation/teams";

export const metadata: Metadata = { title: "Team" };

export default async function TeamOverviewPage({ params }: { params: Promise<{ slug: string; teamId: string }> }) {
  const { slug, teamId } = await params;
  const path = `/programs/${slug}/teams/${teamId}`;
  const ctx = await requireSession(path);

  let o;
  try {
    o = await getTeamOverview(ctx, teamId);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  if (o.header.programSlug !== slug) notFound();
  const { team, header } = o;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {!header.programActive ? <InactiveProgramBanner /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href={o.links.builder ?? "/teams"} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
            ← {o.links.builder ? `${header.seasonName} teams` : "My teams"}
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold tracking-tight text-charcoal sm:text-3xl">
            <TeamColorDot color={team.color} className="h-4 w-4" />
            <span className="min-w-0 break-words">{team.name}</span>
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {header.programName} · {header.seasonName}
            {team.division ? ` · ${team.division}` : ""}
          </p>
          {!team.isActive ? <Badge className="mt-2">Inactive</Badge> : null}
        </div>
        {o.canManage ? (
          <div className="flex flex-wrap gap-2">
            <Link href={o.links.builder!} className={buttonStyles({ variant: "secondary", size: "sm" })}>
              Manage team
            </Link>
            <RotateTokenButton teamId={team.id} path={path} />
          </div>
        ) : null}
      </div>

      <TeamTabs slug={slug} teamId={team.id} active="overview" />

      <Card>
        <CardHeader title="Coaches and staff" />
        {o.staff.length === 0 ? (
          <EmptyState title="No staff assigned" description={o.canManage ? "Add a head coach from the team builder." : "A program admin will assign coaches."} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {o.staff.map((s) => (
              <li key={s.teamStaffId} className="space-y-1.5 rounded-2xl border border-line-soft bg-white px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-bold text-charcoal">{s.name}</p>
                  <Badge tone="info">{TEAM_STAFF_ROLE_LABELS[s.role]}</Badge>
                </div>
                <p className="truncate text-xs text-stone-500">
                  {s.email}
                  {s.phone ? ` · ${formatPhone(s.phone)}` : ""}
                </p>
                <CredentialReadiness readiness={s.readiness} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={`Roster (${o.roster.length})`} description="Medical details are on the Emergency tab, not here." />
        <TeamRoster roster={o.roster} />
      </Card>
    </div>
  );
}
