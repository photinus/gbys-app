// Client-safe labels/helpers for volunteer roles.
export const VOLUNTEER_ROLE_PERIODS = ["per_season", "per_year"] as const;
export type VolunteerRolePeriod = (typeof VOLUNTEER_ROLE_PERIODS)[number];

export const PERIOD_LABELS: Record<VolunteerRolePeriod, string> = {
  per_season: "Per season",
  per_year: "Per year",
};

export const ASSIGNMENT_STATUSES = ["pending", "active", "declined", "withdrawn", "ended"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  pending: "Pending approval",
  active: "Active",
  declined: "Declined",
  withdrawn: "Withdrawn",
  ended: "Ended",
};

/** "60 hrs per season" / "50 hrs per year" */
export function formatExpectation(expectedMinutes: number, period: VolunteerRolePeriod): string {
  const hrs = Math.round((expectedMinutes / 60) * 100) / 100;
  return `${hrs.toLocaleString("en-US", { maximumFractionDigits: 2 })} hrs ${period === "per_season" ? "per season" : "per year"}`;
}

/** Fulfilment percent (0-999), null when nothing is expected. */
export function fulfilmentPercent(loggedMinutes: number, expectedMinutes: number | null): number | null {
  if (!expectedMinutes) return null;
  return Math.min(999, Math.round((loggedMinutes / expectedMinutes) * 100));
}
