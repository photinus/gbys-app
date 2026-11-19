import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TeamColorDot } from "@/components/teams/team-color";
import { requireSession } from "@/lib/dal/context";
import { listMyTeams } from "@/lib/dal/teams";
import { formatDateTime } from "@/lib/format";
import { TEAM_STAFF_ROLE_LABELS } from "@/lib/validation/teams";

export const metadata: Metadata = { title: "My teams" };

const KIND_LABEL = { practice: "Practice", game: "Game", event: "Event" } as const;

export default async function MyTeamsPage() {
  const ctx = await requireSession("/teams");
  const rows = await listMyTeams(ctx);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal sm:text-3xl">My teams</h1>
        <p className="mt-1 text-sm text-stone-500">Rosters, schedules and emergency sheets for the teams you coach or run.</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="You're not on a team yet" description="When a program admin adds you to a team, it shows up here." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((t) => {
            const href = `/programs/${t.programSlug}/teams/${t.id}`;
            return (
              <li key={t.id}>
                <Card className="flex h-full flex-col gap-3 overflow-hidden p-0 sm:p-0">
                  <div className="h-1.5" style={{ backgroundColor: t.color ?? "#95A9F9" }} />
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="flex items-center gap-2 text-base font-bold text-charcoal">
                          <TeamColorDot color={t.color} />
                          <Link href={href} className="truncate hover:underline">
                            {t.name}
                          </Link>
                        </h2>
                        <p className="mt-0.5 truncate text-xs text-stone-500">
                          {t.programName} · {t.seasonName}
                          {t.division ? ` · ${t.division}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {t.myRoles.map((r) => (
                          <Badge key={r} tone="info">
                            {TEAM_STAFF_ROLE_LABELS[r]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-stone-600">{t.playerCount} player{t.playerCount === 1 ? "" : "s"}</p>
                    <p className="text-xs text-stone-500">
                      {t.nextEvent ? (
                        <>
                          <span className="font-semibold text-charcoal">Next: </span>
                          {KIND_LABEL[t.nextEvent.kind]}
                          {t.nextEvent.opponent ? ` vs ${t.nextEvent.opponent}` : ""} · {formatDateTime(t.nextEvent.startsAt)}
                        </>
                      ) : (
                        "Nothing scheduled yet"
                      )}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2 pt-1 text-xs font-semibold">
                      <Link href={href} className="rounded-full bg-charcoal px-3.5 py-2 text-white hover:bg-stone-800">
                        Roster
                      </Link>
                      <Link href={`${href}/schedule`} className="rounded-full border border-line bg-white px-3.5 py-2 text-charcoal hover:bg-stone-50">
                        Schedule
                      </Link>
                      <Link href={`${href}/emergency`} className="rounded-full border border-line bg-white px-3.5 py-2 text-charcoal hover:bg-stone-50">
                        Emergency
                      </Link>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
