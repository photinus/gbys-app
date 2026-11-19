"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, Pencil, Plus, X } from "lucide-react";
import { Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { CancelEventModal } from "./cancel-event-modal";
import { EventFormModal } from "./event-form-modal";
import { EventRow } from "./event-row";
import { dayKey, formatWeekHeading, groupBy, weekStartKey } from "./group";
import { SubscribePanel } from "./subscribe-panel";
import type { EventItem, FacilityOption } from "./types";

export function TeamSchedule({
  slug,
  team,
  events,
  canSchedule,
  autoApproves,
  facilities,
  baseUrl,
  calendarToken,
  view,
}: {
  slug: string;
  team: { id: string; name: string; isActive: boolean };
  events: EventItem[];
  canSchedule: boolean;
  autoApproves: boolean;
  facilities: FacilityOption[];
  baseUrl: string;
  calendarToken: string;
  view: "upcoming" | "past";
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [cancelling, setCancelling] = useState<EventItem | null>(null);

  const weeks = useMemo(
    () => groupBy(events, (e) => weekStartKey(dayKey(e.startsAt))).map((g) => ({ ...g, label: formatWeekHeading(g.key) })),
    [events]
  );
  const pending = events.filter((e) => e.status === "scheduled" && e.bookingStatus === "requested").length;
  const base = `/programs/${slug}/teams/${team.id}/schedule`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={view === "upcoming" ? "Upcoming" : "Past events"}
          description={
            canSchedule
              ? "Practices, games and events. Facility time is checked against other bookings when you save."
              : "Practices, games and events for this team."
          }
          action={
            <>
              <Link
                href={view === "upcoming" ? `${base}?view=past` : base}
                className="rounded-full px-3.5 py-2 text-xs font-semibold text-stone-600 hover:bg-alabaster hover:text-charcoal"
              >
                {view === "upcoming" ? "Show past" : "Show upcoming"}
              </Link>
              {canSchedule && team.isActive ? (
                <Button size="sm" onClick={() => setAdding(true)} data-testid="add-event">
                  <Plus className="h-4 w-4" /> Add
                </Button>
              ) : null}
            </>
          }
        />
        {pending > 0 ? (
          <p className="mb-4 rounded-xl bg-amber-soft/30 px-3.5 py-2.5 text-xs font-medium text-amber-950">
            {pending} {pending === 1 ? "event is" : "events are"} waiting for facility approval.
          </p>
        ) : null}
        {weeks.length === 0 ? (
          <EmptyState
            title={view === "upcoming" ? "Nothing scheduled yet" : "No past events"}
            description={canSchedule && view === "upcoming" ? "Add a practice, game or event to get started." : undefined}
            action={
              canSchedule && team.isActive && view === "upcoming" ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" /> Add to schedule
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-6">
            {weeks.map((w) => (
              <section key={w.key} aria-label={w.label}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-stone-500">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {w.label}
                </h3>
                <ul className="space-y-2">
                  {w.items.map((e) => (
                    <EventRow
                      key={e.id}
                      e={e}
                      actions={
                        canSchedule && team.isActive && e.status === "scheduled" ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`Edit ${e.title}`}>
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setCancelling(e)} aria-label={`Cancel ${e.title}`}>
                              <X className="h-3.5 w-3.5" /> Cancel
                            </Button>
                          </>
                        ) : null
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Subscribe" description="Get this schedule in your own calendar app." />
        <SubscribePanel teamName={team.name} baseUrl={baseUrl} token={calendarToken} />
      </Card>

      {canSchedule ? (
        <>
          <EventFormModal
            open={adding}
            onClose={() => setAdding(false)}
            slug={slug}
            teamId={team.id}
            teamName={team.name}
            facilities={facilities}
            autoApproves={autoApproves}
          />
          <EventFormModal
            open={!!editing}
            onClose={() => setEditing(null)}
            slug={slug}
            teamId={team.id}
            teamName={team.name}
            facilities={facilities}
            autoApproves={autoApproves}
            event={editing ?? undefined}
          />
          <CancelEventModal event={cancelling} slug={slug} teamId={team.id} onClose={() => setCancelling(null)} />
        </>
      ) : null}
    </div>
  );
}
