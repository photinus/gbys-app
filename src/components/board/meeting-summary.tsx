import { CalendarDays, Link2, MapPin } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatDateTime, formatTimeRange } from "@/lib/format";
import { MEETING_KIND_LABELS } from "@/lib/validation/board";
import type { MinutesState } from "@/lib/dal/board-meetings";
import { Markdown, safeHref } from "./markdown";

export function MeetingStatusBadge({ status }: { status: "scheduled" | "held" | "cancelled" }) {
  return status === "cancelled" ? <Badge tone="danger">Cancelled</Badge> : status === "held" ? <Badge tone="success">Held</Badge> : <Badge tone="info">Scheduled</Badge>;
}

export function MinutesStateBadge({ state }: { state: MinutesState }) {
  if (state === "public") return <Badge tone="info">Minutes public</Badge>;
  if (state === "approved") return <Badge tone="success">Minutes approved</Badge>;
  if (state === "draft") return <Badge tone="warning">Minutes draft</Badge>;
  return <Badge>No minutes</Badge>;
}

export interface SummaryMeeting {
  kind: keyof typeof MEETING_KIND_LABELS;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  virtualUrl: string | null;
  agenda: string | null;
}

/** When, where, link and agenda. Shared by the board and member views (no private fields). */
export function MeetingSummary({ meeting, showAgenda = true }: { meeting: SummaryMeeting; showAgenda?: boolean }) {
  const link = meeting.virtualUrl ? safeHref(meeting.virtualUrl) : null;
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-start gap-2 text-charcoal">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden />
        <span>
          {meeting.endsAt ? formatTimeRange(meeting.startsAt, meeting.endsAt) : formatDateTime(meeting.startsAt)}
          <span className="text-stone-400"> · Pacific time · {MEETING_KIND_LABELS[meeting.kind]}</span>
        </span>
      </p>
      {meeting.location ? (
        <p className="flex items-start gap-2 text-charcoal">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden />
          <span className="min-w-0 break-words">{meeting.location}</span>
        </p>
      ) : null}
      {link ? (
        <p className="flex items-start gap-2">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" aria-hidden />
          <a href={link} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all font-medium text-indigo-700 underline">
            Join online
          </a>
        </p>
      ) : null}
      {showAgenda && meeting.agenda ? (
        <div className="rounded-2xl bg-alabaster/60 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Agenda</p>
          <Markdown source={meeting.agenda} />
        </div>
      ) : null}
    </div>
  );
}
