import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { MeetingStatusBadge, MinutesStateBadge } from "@/components/board/meeting-summary";
import { NewMeetingButton } from "@/components/board/meeting-form-modal";
import { Badge, Card, CardHeader, EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { listMeetings } from "@/lib/dal/board-meetings";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MEETING_KIND_LABELS } from "@/lib/validation/board";

export const metadata: Metadata = { title: "Board meetings" };
export const dynamic = "force-dynamic";

const RANGES = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
] as const;

export default async function BoardMeetingsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requireSession("/admin/board/meetings");
  const { range: raw } = await searchParams;
  const range = RANGES.find((r) => r.key === raw)?.key ?? "all";
  const meetings = await listMeetings(ctx, { range });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/board" className="text-xs font-semibold text-indigo-700 hover:underline">
          Board of Directors
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Meetings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Schedule meetings, take attendance and keep minutes.{" "}
          <Link href="/admin/board/motions" className="font-semibold text-indigo-700 hover:underline">
            Motions and votes
          </Link>
        </p>
      </div>

      <Card>
        <CardHeader title="Meetings" description="Pacific time." action={<NewMeetingButton />} />
        <nav aria-label="Range" className="mb-4 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-white p-1 text-sm font-semibold shadow-sm">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={r.key === "all" ? "/admin/board/meetings" : `/admin/board/meetings?range=${r.key}`}
              aria-current={range === r.key ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-full px-4 py-2", range === r.key ? "bg-charcoal text-white" : "text-stone-600 hover:bg-alabaster")}
            >
              {r.label}
            </Link>
          ))}
        </nav>
        {meetings.length === 0 ? (
          <EmptyState title="No meetings here yet" description="Schedule the next board meeting to start the agenda and attendance." />
        ) : (
          <Table className="min-w-[820px]" data-testid="meetings-table">
            <THead>
              <tr>
                <TH className="pl-2">Meeting</TH>
                <TH>When</TH>
                <TH>Status</TH>
                <TH>Attendance</TH>
                <TH>Minutes</TH>
                <TH className="pr-2 text-right">Calendar</TH>
              </tr>
            </THead>
            <TBody>
              {meetings.map((m) => (
                <TR key={m.id} data-testid="meeting-row">
                  <TD className="pl-2">
                    <Link href={`/admin/board/meetings/${m.id}`} className="font-semibold text-charcoal hover:underline">
                      {m.title}
                    </Link>
                    <div className="text-xs text-stone-500">
                      {MEETING_KIND_LABELS[m.kind]} {m.isPublic ? null : <Badge className="ml-1 !py-0.5">Board only</Badge>}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap text-charcoal">{formatDateTime(m.startsAt)}</TD>
                  <TD>
                    <MeetingStatusBadge status={m.status} />
                  </TD>
                  <TD className="whitespace-nowrap text-charcoal">{m.attendanceRecorded ? `${m.attendedCount} attended` : <span className="text-stone-400">Not recorded</span>}</TD>
                  <TD>
                    <MinutesStateBadge state={m.minutesState} />
                  </TD>
                  <TD className="pr-2 text-right">
                    <a href={`/admin/board/meetings/${m.id}/ics`} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline" aria-label={`Download calendar file for ${m.title}`}>
                      <Download className="h-3.5 w-3.5" aria-hidden /> .ics
                    </a>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
