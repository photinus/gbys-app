import type { EventBookingStatus } from "@/lib/dal/team-schedule";

/** Serializable event passed from server pages to client components (dates as ISO strings). */
export interface EventItem {
  id: string;
  teamId: string;
  teamName: string;
  teamColor: string | null;
  kind: "practice" | "game" | "event";
  title: string;
  rawTitle: string | null;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "cancelled";
  resourceId: string | null;
  resourceName: string | null;
  locationText: string | null;
  opponent: string | null;
  site: "home" | "away" | "neutral" | null;
  seriesId: string | null;
  notes: string | null;
  bookingStatus: EventBookingStatus;
  decisionNote: string | null;
  /** Parent schedule only: names of my athletes on the team. */
  athletes?: string[];
  staffRole?: string | null;
}

export type { FacilityOption } from "@/lib/dal/team-schedule";
