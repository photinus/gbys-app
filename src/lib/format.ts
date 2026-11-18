// All display formatting is America/Los_Angeles (invariant 9). No external deps.
const TZ = "America/Los_Angeles";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  timeZoneName: "longOffset",
  hour: "numeric",
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDate(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

/** e.g. "Nov 17, 2026" in Pacific time. */
export function formatDate(d: Date | string | number): string {
  return dateFmt.format(toDate(d));
}

/** e.g. "Nov 17, 2026, 5:30 PM" in Pacific time. */
export function formatDateTime(d: Date | string | number): string {
  return dateTimeFmt.format(toDate(d));
}

/** Date-only string (YYYY-MM-DD) -> "Mar 4, 2015". No timezone shift. */
export function formatDob(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return dateStr;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return dateStr;
  return `${MONTHS[month - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Offset (in minutes, east-positive) of America/Los_Angeles at a given instant. */
function laOffsetMinutes(at: Date): number {
  const part = offsetFmt.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/**
 * Convert a `<input type="date">` value (YYYY-MM-DD, interpreted in
 * America/Los_Angeles) into a UTC Date. endOfDay (default) = 23:59:59.999 local,
 * otherwise 00:00:00.000 local.
 */
export function laDateInputToUtc(yyyyMmDd: string, endOfDay = true): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) throw new Error(`Invalid date: ${yyyyMmDd}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wall = endOfDay
    ? Date.UTC(y, mo - 1, d, 23, 59, 59, 999)
    : Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  // Guess with the offset at the naive instant, then re-check (handles DST edges).
  let off = laOffsetMinutes(new Date(wall));
  let utc = wall - off * 60_000;
  const off2 = laOffsetMinutes(new Date(utc));
  if (off2 !== off) {
    off = off2;
    utc = wall - off * 60_000;
  }
  return new Date(utc);
}

/** UTC Date -> YYYY-MM-DD (Pacific calendar date) for `<input type="date">`. */
export function utcToLaDateInput(d: Date | string | number): string {
  return ymdFmt.format(toDate(d));
}

/** Whole calendar days from today (Pacific) until d (Pacific). Negative if past. */
export function daysUntil(d: Date | string | number): number {
  const target = utcToLaDateInput(d);
  const today = utcToLaDateInput(new Date());
  const t = Date.UTC(+target.slice(0, 4), +target.slice(5, 7) - 1, +target.slice(8, 10));
  const n = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.round((t - n) / 86_400_000);
}
