"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";
import { EventRow } from "./event-row";
import { dayKey, formatDayLong, groupBy } from "./group";
import { SubscribePanel } from "./subscribe-panel";
import type { EventItem } from "./types";

export interface ScheduleTeam {
  id: string;
  name: string;
  programSlug: string;
  calendarToken: string;
  athletes: { id: string; name: string }[];
  staffRole: string | null;
}

export function ParentSchedule({
  events,
  teams,
  athletes,
  baseUrl,
}: {
  events: (EventItem & { athleteIds: string[] })[];
  teams: ScheduleTeam[];
  athletes: { id: string; name: string }[];
  baseUrl: string;
}) {
  const [athleteId, setAthleteId] = useState<string>("all");
  const visible = useMemo(
    () => (athleteId === "all" ? events : events.filter((e) => e.athleteIds.includes(athleteId))),
    [events, athleteId]
  );
  const days = useMemo(() => groupBy(visible, (e) => dayKey(e.startsAt)), [visible]);
  const shownTeams = athleteId === "all" ? teams : teams.filter((t) => t.athletes.some((a) => a.id === athleteId));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Next 4 weeks" description="Practices, games and events for your athletes' teams and the teams you coach." />
        {athletes.length > 1 ? (
          <div role="group" aria-label="Filter by athlete" className="mb-4 flex flex-wrap gap-2">
            {[{ id: "all", name: "Everyone" }, ...athletes].map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAthleteId(a.id)}
                aria-pressed={athleteId === a.id}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-semibold",
                  athleteId === a.id ? "border-charcoal bg-charcoal text-white" : "border-line bg-white text-stone-600 hover:bg-alabaster"
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
        ) : null}
        {days.length === 0 ? (
          <EmptyState title="Nothing scheduled" description="When a coach adds practices or games for your athlete's team, they show up here." />
        ) : (
          <div className="space-y-5">
            {days.map((d) => (
              <section key={d.key} aria-label={formatDayLong(d.key)}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">{formatDayLong(d.key)}</h3>
                <ul className="space-y-2">
                  {d.items.map((e) => (
                    <EventRow key={e.id} e={e} showDay={false} showTeam />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      {shownTeams.length > 0 ? (
        <Card>
          <CardHeader title="Calendar subscriptions" description="One private link per team. Add it once and your phone stays up to date." />
          <div className="space-y-4">
            {shownTeams.map((t) => (
              <div key={t.id} className="min-w-0 space-y-2">
                <p className="text-sm font-semibold text-charcoal break-words">
                  {t.name}
                  {t.athletes.length > 0 ? <span className="font-normal text-stone-500"> · {t.athletes.map((a) => a.name).join(", ")}</span> : null}
                </p>
                <SubscribePanel teamName={t.name} baseUrl={baseUrl} token={t.calendarToken} />
                {t.staffRole ? (
                  <Link href={`/programs/${t.programSlug}/teams/${t.id}/schedule`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
                    Open the team schedule
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
