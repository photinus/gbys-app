import { addDaysYmd, weekdayOfYmd } from "@/lib/validation/team-schedule";
import { utcToLaDateInput } from "@/lib/format";

const TZ = "America/Los_Angeles";
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const dayLongFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
const shortFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function ymdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** LA calendar date (YYYY-MM-DD) of an ISO instant. */
export function dayKey(iso: string): string {
  return utcToLaDateInput(iso);
}

/** Monday of the week containing the given calendar date. */
export function weekStartKey(ymd: string): string {
  const wd = weekdayOfYmd(ymd); // 0 = Sun
  return addDaysYmd(ymd, -((wd + 6) % 7));
}

export function formatDayShort(ymd: string): string {
  return dayFmt.format(ymdToUtcDate(ymd));
}
export function formatDayLong(ymd: string): string {
  return dayLongFmt.format(ymdToUtcDate(ymd));
}
export function formatWeekHeading(weekStartYmd: string): string {
  return `Week of ${shortFmt.format(ymdToUtcDate(weekStartYmd))}`;
}

export function groupBy<T>(items: T[], key: (t: T) => string): { key: string; items: T[] }[] {
  const out: { key: string; items: T[] }[] = [];
  const idx = new Map<string, { key: string; items: T[] }>();
  for (const it of items) {
    const k = key(it);
    let g = idx.get(k);
    if (!g) {
      g = { key: k, items: [] };
      idx.set(k, g);
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

export { TZ };
