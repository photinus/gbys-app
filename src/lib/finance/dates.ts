import { utcToLaDateInput } from "@/lib/format";

/**
 * Accounting dates are plain "YYYY-MM-DD" strings for the America/Los_Angeles
 * calendar day (Postgres `date`). Compare them as strings; never build a Date
 * from them without laDateInputToUtc.
 */
export type IsoDate = string;

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today's LA calendar date. */
export function laToday(now: Date = new Date()): IsoDate {
  return utcToLaDateInput(now);
}

/** LA calendar date of an instant (e.g. a Stripe `created` timestamp). */
export function laDateOf(instant: Date | number): IsoDate {
  return utcToLaDateInput(instant);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Last day of the month containing `date`. */
export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m, 0));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Fiscal year containing `date` for a fiscal year starting on `startMonth` (1-12).
 * `label` is the calendar year the fiscal year ENDS in (FY2027 = Jul 2026–Jun 2027),
 * or just the year when the fiscal year is the calendar year.
 * Bounds are inclusive dates.
 */
export function fiscalYearOf(date: IsoDate, startMonth: number): { start: IsoDate; end: IsoDate; label: string } {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${pad(startMonth)}-01`;
  const nextStart = startMonth === 1 ? `${startYear + 1}-01-01` : `${startYear + 1}-${pad(startMonth)}-01`;
  const end = addDays(nextStart, -1);
  const endYear = Number(end.slice(0, 4));
  return { start, end, label: startMonth === 1 ? String(startYear) : `FY${endYear}` };
}
