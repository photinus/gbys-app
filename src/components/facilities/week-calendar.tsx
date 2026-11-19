import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Card, buttonStyles } from "@/components/ui";
import type { CalendarBooking } from "@/lib/dal/facilities";
import { formatTime, laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import type { FacilityNode } from "@/lib/validation/facilities";

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" });

/** YYYY-MM-DD + n days (pure calendar arithmetic, no timezone). */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing ymd. */
export function mondayOf(ymd: string): string {
  const dow = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay(); // 0 = Sun
  return addDaysYmd(ymd, -((dow + 6) % 7));
}

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

interface Day {
  ymd: string;
  start: Date;
  end: Date;
  label: string;
}

function weekDays(weekStart: string): Day[] {
  return Array.from({ length: 7 }, (_, i) => {
    const ymd = addDaysYmd(weekStart, i);
    const start = laDateInputToUtc(ymd, false);
    return { ymd, start, end: laDateInputToUtc(addDaysYmd(ymd, 1), false), label: dayFmt.format(start) };
  });
}

const overlaps = (b: CalendarBooking, d: Day) => b.startsAt < d.end && b.endsAt > d.start;

function chipStyle(b: CalendarBooking): { className: string; style?: React.CSSProperties } {
  if (b.busy) return { className: "border border-stone-200 bg-stone-100 text-stone-500" };
  const color = b.team?.color ?? "#95a9f9";
  if (b.status === "requested") return { className: "border border-dashed bg-white/70", style: { borderColor: color, borderLeftWidth: 4 } };
  return { className: "border border-transparent", style: { backgroundColor: `${color}33`, borderLeftColor: color, borderLeftWidth: 4 } };
}

function Chip({ b, inherited, facilityName }: { b: CalendarBooking; inherited?: boolean; facilityName?: string }) {
  const { className, style } = chipStyle(b);
  return (
    <div
      className={`min-w-0 rounded-lg px-2 py-1 text-[11px] leading-snug text-charcoal ${className} ${inherited ? "opacity-60" : ""}`}
      style={style}
      data-testid="cal-chip"
      data-status={b.busy ? "busy" : b.status}
      title={`${b.title}${b.team ? ` (${b.team.name})` : ""}`}
    >
      <p className="font-semibold tabular-nums">
        {formatTime(b.startsAt)} – {formatTime(b.endsAt)}
        {b.status === "requested" && !b.busy ? <span className="ml-1 font-medium text-amber-900">(requested)</span> : null}
      </p>
      <p className="truncate">{inherited && facilityName ? `${facilityName}: ` : ""}{b.title}</p>
      {b.team ? <p className="truncate text-stone-600">{b.team.name}</p> : null}
    </div>
  );
}

export function WeekCalendar({
  facilities,
  bookings,
  weekStart,
  baseHref,
}: {
  facilities: FacilityNode[];
  bookings: CalendarBooking[];
  /** Monday, YYYY-MM-DD */
  weekStart: string;
  /** e.g. "/admin/facilities?tab=calendar"; "&week=YYYY-MM-DD" is appended. */
  baseHref: string;
}) {
  const days = weekDays(weekStart);
  const today = utcToLaDateInput(new Date());
  const byId = new Map(facilities.map((f) => [f.id, f]));
  const ancestorIds = (f: FacilityNode) => {
    const out: string[] = [];
    let p = f.parentResourceId;
    while (p && byId.has(p) && out.length < 16) {
      out.push(p);
      p = byId.get(p)!.parentResourceId;
    }
    return out;
  };
  const href = (w: string) => `${baseHref}${baseHref.includes("?") ? "&" : "?"}week=${w}`;
  const range = `${days[0].label} – ${days[6].label}`;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="text-lg font-bold text-charcoal">Week of {days[0].label}</h2>
          <p className="text-xs text-stone-500">{range} · Pacific time</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href={href(addDaysYmd(weekStart, -7))} className={buttonStyles({ variant: "secondary", size: "sm" })} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link href={href(mondayOf(today))} className={buttonStyles({ variant: "secondary", size: "sm" })}>
            This week
          </Link>
          <Link href={href(addDaysYmd(weekStart, 7))} className={buttonStyles({ variant: "secondary", size: "sm" })} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pb-4 text-[11px] text-stone-600">
        <Badge tone="success">Approved</Badge>
        <span className="rounded-full border border-dashed border-stone-400 px-2.5 py-0.5 font-semibold">Requested (tentative)</span>
        <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-semibold text-stone-500">Booked (other program)</span>
        <span className="opacity-70">Faded = booked on a parent facility</span>
      </div>

      {facilities.length === 0 ? (
        <p className="text-sm text-stone-500">No facilities to show.</p>
      ) : (
        <>
          {/* Desktop: facilities as rows, days as columns */}
          <div className="hidden overflow-x-auto lg:block" data-testid="cal-grid">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-left">
              <thead>
                <tr>
                  <th className="w-40 border-b border-line-soft pb-2 pr-2 text-xs font-semibold text-stone-500">Facility</th>
                  {days.map((d) => (
                    <th key={d.ymd} className={`border-b border-line-soft px-1 pb-2 text-xs font-semibold ${d.ymd === today ? "text-indigo-700" : "text-stone-500"}`}>
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facilities.map((f) => {
                  const anc = new Set(ancestorIds(f));
                  return (
                    <tr key={f.id} className="align-top">
                      <th scope="row" className="border-b border-line-soft py-2 pr-2 text-xs font-semibold text-charcoal" style={{ paddingLeft: f.depth * 12 }}>
                        <span className="block truncate">{f.name}</span>
                      </th>
                      {days.map((d) => {
                        const own = bookings.filter((b) => b.resourceId === f.id && overlaps(b, d));
                        const inh = bookings.filter((b) => anc.has(b.resourceId) && b.status === "approved" && overlaps(b, d));
                        return (
                          <td key={d.ymd} className={`border-b border-line-soft p-1 ${d.ymd === today ? "bg-periwinkle/10" : ""}`}>
                            <div className="space-y-1">
                              {inh.map((b) => (
                                <Chip key={`i-${b.id}`} b={b} inherited facilityName={byId.get(b.resourceId)?.name} />
                              ))}
                              {own.map((b) => (
                                <Chip key={b.id} b={b} />
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet: day list */}
          <div className="space-y-4 lg:hidden" data-testid="cal-days">
            {days.map((d) => {
              const list = bookings.filter((b) => overlaps(b, d));
              return (
                <section key={d.ymd}>
                  <h3 className={`text-xs font-bold ${d.ymd === today ? "text-indigo-700" : "text-stone-600"}`}>
                    {d.label}
                    {d.ymd === today ? " · Today" : ""}
                  </h3>
                  {list.length === 0 ? (
                    <p className="mt-1 text-xs text-stone-400">Nothing booked.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1.5">
                      {list.map((b) => (
                        <li key={b.id}>
                          <p className="px-0.5 text-[11px] font-semibold text-stone-500">{byId.get(b.resourceId)?.name ?? "Facility"}</p>
                          <Chip b={b} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
