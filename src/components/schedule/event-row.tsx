import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BookingBadge } from "./booking-badge";
import { formatDayShort, dayKey } from "./group";
import type { EventItem } from "./types";

const KIND_LABEL = { practice: "Practice", game: "Game", event: "Event" } as const;

export function eventPlace(e: EventItem): string | null {
  return e.resourceName ?? e.locationText;
}

/** One schedule entry. Cancelled events are struck through. `actions` renders at the right/bottom. */
export function EventRow({
  e,
  showDay = true,
  showTeam = false,
  actions,
}: {
  e: EventItem;
  showDay?: boolean;
  showTeam?: boolean;
  actions?: ReactNode;
}) {
  const cancelled = e.status === "cancelled";
  const place = eventPlace(e);
  return (
    <li
      data-testid="schedule-event"
      data-status={e.status}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-white px-4 py-3 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: e.teamColor ?? "#a8a29e" }}
        />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold text-charcoal break-words", cancelled && "line-through text-stone-400")}>
            {showTeam ? `${e.teamName} · ` : null}
            {e.title}
          </p>
          <p className={cn("text-xs text-stone-500", cancelled && "line-through")}>
            {showDay ? `${formatDayShort(dayKey(e.startsAt))} · ` : null}
            {formatTime(e.startsAt)} – {formatTime(e.endsAt)}
          </p>
          {place ? (
            <p className={cn("mt-0.5 flex items-start gap-1 text-xs text-stone-500 break-words", cancelled && "line-through")}>
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="min-w-0">{place}</span>
            </p>
          ) : null}
          {e.notes ? <p className="mt-1 text-xs text-stone-400 break-words">{e.notes}</p> : null}
          {e.bookingStatus === "declined" && e.decisionNote ? (
            <p className="mt-1 text-xs text-rose-800 break-words">Declined: {e.decisionNote}</p>
          ) : null}
          {e.athletes && e.athletes.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {e.athletes.map((a) => (
                <Badge key={a} tone="info" data-testid="athlete-label">
                  {a}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{KIND_LABEL[e.kind]}</Badge>
        {e.site === "away" ? <Badge tone="neutral">Away</Badge> : null}
        {e.resourceId || e.bookingStatus !== "none" ? (
          <BookingBadge status={e.bookingStatus} cancelled={cancelled} />
        ) : cancelled ? (
          <Badge tone="neutral">Cancelled</Badge>
        ) : null}
        {actions}
      </div>
    </li>
  );
}
