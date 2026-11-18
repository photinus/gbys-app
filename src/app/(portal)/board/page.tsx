import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { MeetingSummary } from "@/components/board/meeting-summary";
import { Badge, Card, CardHeader, EmptyState, buttonStyles } from "@/components/ui";
import { isBoard, requireSession } from "@/lib/dal/context";
import { getMySeat } from "@/lib/dal/board-shared";
import { listPublicMeetings } from "@/lib/dal/board-meetings";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Board meetings" };
export const dynamic = "force-dynamic";

export default async function BoardMeetingsMemberPage() {
  const ctx = await requireSession("/board");
  const [{ upcoming, past }, seat] = await Promise.all([listPublicMeetings(ctx), getMySeat(ctx)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Board meetings</h1>
        <p className="mt-1 text-sm text-stone-500">When the GBYS Board of Directors meets, and the approved minutes. Times are Pacific.</p>
      </div>

      {seat || isBoard(ctx) ? (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-charcoal">
              {seat ? "You hold a board seat." : "You manage the Board of Directors."}
            </p>
            <div className="flex flex-wrap gap-2">
              {seat ? (
                <Link href="/board/votes" className={buttonStyles({ size: "sm" })}>
                  Vote on motions
                </Link>
              ) : null}
              {isBoard(ctx) ? (
                <Link href="/admin/board" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                  Board admin
                </Link>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card data-testid="upcoming-meetings">
        <CardHeader title="Upcoming meetings" />
        {upcoming.length === 0 ? (
          <EmptyState title="No meetings scheduled" description="Check back soon. New meetings appear here as the board schedules them." />
        ) : (
          <ul className="space-y-5">
            {upcoming.map((m) => (
              <li key={m.id} className="space-y-3 rounded-2xl border border-line p-4" data-testid="public-meeting">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/board/meetings/${m.id}`} className="text-base font-bold text-charcoal hover:underline">
                      {m.title}
                    </Link>
                    {m.status === "cancelled" ? <Badge tone="danger">Cancelled</Badge> : null}
                  </div>
                  <a href={`/board/meetings/${m.id}/ics`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
                    <Download className="h-4 w-4" aria-hidden /> Add to calendar
                  </a>
                </div>
                <MeetingSummary meeting={m} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="past-meetings">
        <CardHeader title="Past meetings and minutes" />
        {past.length === 0 ? (
          <EmptyState title="No past meetings yet" />
        ) : (
          <ul className="divide-y divide-line-soft">
            {past.map((m) => (
              <li key={m.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="public-meeting">
                <div className="min-w-0">
                  <Link href={`/board/meetings/${m.id}`} className="text-sm font-semibold text-charcoal hover:underline">
                    {m.title}
                  </Link>
                  <p className="text-xs text-stone-500">{formatDateTime(m.startsAt)}</p>
                </div>
                {m.hasMinutes ? <Badge tone="success">Minutes available</Badge> : <Badge>No minutes posted</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
