import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui";
import { TeamSchedule } from "@/components/schedule/team-schedule";
import { appBaseUrl, toEventItem } from "@/components/schedule/serialize";
import { DalError, requireSession } from "@/lib/dal/context";
import { getTeamScheduleContext, listTeamEvents } from "@/lib/dal/team-schedule";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";

export const metadata: Metadata = { title: "Team schedule" };

const DAY = 86_400_000;

export default async function TeamSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; teamId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug, teamId } = await params;
  const { view: viewParam } = await searchParams;
  const view = viewParam === "past" ? "past" : "upcoming";
  const ctx = await requireSession(`/programs/${slug}/teams/${teamId}/schedule`);

  let sched;
  try {
    sched = await getTeamScheduleContext(ctx, slug, teamId);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }

  const startOfToday = laDateInputToUtc(utcToLaDateInput(new Date()), false);
  const range =
    view === "upcoming"
      ? { from: startOfToday, to: new Date(startOfToday.getTime() + 365 * DAY) }
      : { from: new Date(startOfToday.getTime() - 120 * DAY), to: startOfToday };
  const events = (await listTeamEvents(ctx, teamId, range)).map(toEventItem);
  if (view === "past") events.reverse();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="min-w-0">
        <Link href={`/programs/${slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          {sched.program.name}
        </Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-charcoal break-words">
          {sched.team.color ? (
            <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-full" style={{ backgroundColor: sched.team.color }} />
          ) : null}
          {sched.team.name} schedule
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
          <Link href={`/programs/${slug}/teams/${teamId}`} className="font-semibold hover:text-charcoal">
            Team overview
          </Link>
          {!sched.canSchedule ? <Badge tone="neutral">View only</Badge> : null}
          {!sched.team.isActive ? <Badge tone="warning">Inactive team</Badge> : null}
        </p>
      </div>
      <TeamSchedule
        slug={slug}
        team={{ id: sched.team.id, name: sched.team.name, isActive: sched.team.isActive }}
        events={events}
        canSchedule={sched.canSchedule}
        autoApproves={sched.autoApproves}
        facilities={sched.facilities}
        baseUrl={appBaseUrl()}
        calendarToken={sched.calendarToken}
        view={view}
      />
    </div>
  );
}
