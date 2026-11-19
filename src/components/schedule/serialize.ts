import type { TeamEventView } from "@/lib/dal/team-schedule";
import type { EventItem } from "./types";

export function toEventItem(e: TeamEventView): EventItem {
  return {
    id: e.id,
    teamId: e.teamId,
    teamName: e.teamName,
    teamColor: e.teamColor,
    kind: e.kind,
    title: e.title,
    rawTitle: e.rawTitle,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    status: e.status,
    resourceId: e.resourceId,
    resourceName: e.resourceName,
    locationText: e.locationText,
    opponent: e.opponent,
    site: e.site,
    seriesId: e.seriesId,
    notes: e.notes,
    bookingStatus: e.bookingStatus,
    decisionNote: e.decisionNote,
  };
}

/** Public origin for absolute links (feed URLs). */
export function appBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
