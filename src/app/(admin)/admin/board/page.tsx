import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarDays, FileText, Gavel, Users } from "lucide-react";
import { SeatBadges } from "@/components/board/seat-badges";
import { Card, CardHeader, EmptyState, KpiCard, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getBoardOverview } from "@/lib/dal/board-meetings";
import { formatDateTime, formatDob } from "@/lib/format";

export const metadata: Metadata = { title: "Board of Directors" };
export const dynamic = "force-dynamic";

export default async function BoardOverviewPage() {
  const ctx = await requireSession("/admin/board");
  const o = await getBoardOverview(ctx);
  const seated = o.members.filter((m) => m.status === "current");
  const upcomingSeats = o.members.filter((m) => m.status === "upcoming");
  const warned = o.members.filter((m) => m.warnings.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Board of Directors</h1>
          <p className="mt-1 text-sm text-stone-500">Seats, meetings, minutes and motions in one place. Only the board can see this area.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/board/members" className={buttonStyles({ variant: "secondary", size: "sm" })}>
            Members
          </Link>
          <Link href="/admin/board/meetings" className={buttonStyles({ variant: "secondary", size: "sm" })}>
            Meetings
          </Link>
          <Link href="/admin/board/motions" className={buttonStyles({ variant: "secondary", size: "sm" })}>
            Motions
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Seated directors" value={o.seatedVotingCount} hint="Voting seats today" tone="periwinkle" />
        <KpiCard
          icon={CalendarDays}
          label="Next meeting"
          value={<span className="text-xl">{o.nextMeeting ? formatDateTime(o.nextMeeting.startsAt) : "None scheduled"}</span>}
          hint={o.nextMeeting?.title}
          tone="sage"
        />
        <KpiCard icon={Gavel} label="Open motions" value={o.openMotions} hint="Awaiting votes" tone="amber" />
        <KpiCard icon={FileText} label="Minutes awaiting approval" value={o.minutesAwaiting.length} hint="Draft versions" tone="coral" />
      </div>

      {warned.length > 0 ? (
        <Card data-testid="seat-warnings" className="border-amber-soft/60">
          <CardHeader title="Seats that need attention" description="These won't block anything, but fixing them keeps voting and access working." />
          <ul className="space-y-2 text-sm">
            {warned.map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <strong>{m.displayName}</strong> ({m.position}): {m.warnings[0].message}{" "}
                  <Link href={m.warnings[0].href ?? "/admin/board/members"} className="font-semibold underline">
                    {m.warnings[0].href ? "Open user" : "Edit seat"}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card data-testid="seated-directors">
          <CardHeader title="Seated directors" action={<Link href="/admin/board/members" className="text-xs font-semibold text-indigo-700 hover:underline">Manage seats</Link>} />
          {seated.length === 0 ? (
            <EmptyState title="No seated directors" description="Add each director's seat and term to get started." action={<Link href="/admin/board/members" className={buttonStyles({ size: "sm" })}>Add seats</Link>} />
          ) : (
            <ul className="divide-y divide-line-soft">
              {seated.map((m) => (
                <li key={m.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-charcoal">{m.displayName}</p>
                    <p className="text-xs text-stone-500">
                      {m.position} · term {formatDob(m.termStart)} – {m.termEnd ? formatDob(m.termEnd) : "open"}
                    </p>
                  </div>
                  <SeatBadges status={m.status} daysLeft={m.daysLeft} isVotingDirector={m.isVotingDirector} />
                </li>
              ))}
            </ul>
          )}
          {upcomingSeats.length > 0 ? <p className="mt-3 text-xs text-stone-500">{upcomingSeats.length} upcoming seat{upcomingSeats.length === 1 ? "" : "s"} not yet seated.</p> : null}
        </Card>

        <Card data-testid="minutes-awaiting">
          <CardHeader title="Minutes awaiting approval" />
          {o.minutesAwaiting.length === 0 ? (
            <EmptyState title="Nothing waiting" description="Draft minutes show up here until they are approved." />
          ) : (
            <ul className="divide-y divide-line-soft">
              {o.minutesAwaiting.map((d) => (
                <li key={d.minutesId} className="py-3">
                  <Link href={`/admin/board/meetings/${d.meetingId}`} className="text-sm font-semibold text-charcoal hover:underline">
                    {d.meetingTitle}
                  </Link>
                  <p className="text-xs text-stone-500">
                    Draft v{d.version} · meeting on {formatDateTime(d.startsAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
