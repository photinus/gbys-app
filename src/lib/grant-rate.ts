// Independent Sector volunteer-hour valuation used for in-kind snapshots
// (volunteer_logs.inKindRateCents). Server-side only: reads env at call time.
export const FALLBACK_IN_KIND_HOURLY_RATE_CENTS = 3349;

export function currentInKindRateCents(): number {
  const raw = Number(process.env.DEFAULT_IN_KIND_HOURLY_RATE_CENTS);
  return Number.isInteger(raw) && raw > 0 ? raw : FALLBACK_IN_KIND_HOURLY_RATE_CENTS;
}

/** In-kind value in cents for a duration at a rate, rounded to the nearest cent. */
export function inKindValueCents(durationMinutes: number, rateCents: number): number {
  return Math.round((durationMinutes * rateCents) / 60);
}
