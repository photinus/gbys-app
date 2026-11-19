import { z } from "zod";
import { laDateTimeInputToUtc, utcToLaDateTimeInput } from "@/lib/format";

/** Hard cap on occurrences of one recurring series (plan: <= 60). */
export const MAX_SERIES_OCCURRENCES = 60;
const MAX_EVENT_MS = 24 * 60 * 60 * 1000;
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_D = /^\d{4}-\d{2}-\d{2}$/;

export const uuidSchema = z.string().uuid("Invalid identifier.");
export const TEAM_EVENT_KINDS = ["practice", "game", "event"] as const;
export const TEAM_EVENT_SITES = ["home", "away", "neutral"] as const;
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** datetime-local (Pacific wall clock) -> UTC, or null for a non-existent local time (Feb 31, spring-forward gap). */
export function parseLocalDateTime(value: string): Date | null {
  if (!LOCAL_DT.test(value)) return null;
  const d = laDateTimeInputToUtc(value);
  if (Number.isNaN(d.getTime())) return null;
  return utcToLaDateTimeInput(d) === value ? d : null;
}

function dateOnlyValid(s: string): boolean {
  if (!LOCAL_D.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Add whole calendar days to a YYYY-MM-DD string (pure calendar math, no timezone). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday for a calendar date. */
export function weekdayOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const optText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (${max} max).`)
    .transform((v) => v || null)
    .nullish()
    .transform((v) => v ?? null);

const recurrenceSchema = z.object({
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Pick at least one weekday for a repeating practice.")
    .max(7)
    .transform((a) => [...new Set(a)].sort((x, y) => x - y)),
  until: z.string().trim().refine(dateOnlyValid, "Choose a valid end date for the repeat."),
});

const baseObject = z.object({
  kind: z.enum(TEAM_EVENT_KINDS, { error: "Choose practice, game or event." }),
  startsAt: z.string().trim(),
  endsAt: z.string().trim(),
  resourceId: z
    .string()
    .trim()
    .transform((v) => v || null)
    .pipe(z.string().uuid("Choose a valid facility.").nullable())
    .nullish()
    .transform((v) => v ?? null),
  locationText: optText(200, "Location"),
  title: optText(120, "Title"),
  notes: optText(1000, "Notes"),
  opponent: optText(120, "Opponent"),
  site: z.enum(TEAM_EVENT_SITES).nullish().transform((v) => v ?? null),
  recurrence: recurrenceSchema.nullish().transform((v) => v ?? null),
});

export interface ParsedTeamEventInput {
  kind: (typeof TEAM_EVENT_KINDS)[number];
  startsAt: Date;
  endsAt: Date;
  /** Wall-clock pieces, used to expand a recurrence while keeping LA local times across DST. */
  startLocal: string;
  endLocal: string;
  resourceId: string | null;
  locationText: string | null;
  title: string | null;
  notes: string | null;
  opponent: string | null;
  site: (typeof TEAM_EVENT_SITES)[number] | null;
  recurrence: { weekdays: number[]; until: string } | null;
}

/**
 * Create / edit form. datetime-local strings are America/Los_Angeles wall clock.
 * Normalises per-kind rules: home games need a facility, away games need a
 * location (and never a facility), practices/events need one or the other.
 */
export const teamEventSchema = baseObject.transform((v, ctx): ParsedTeamEventInput => {
  const fail = (message: string, path: string): never => {
    ctx.addIssue({ code: "custom", message, path: [path] });
    return z.NEVER;
  };
  const startsAt = parseLocalDateTime(v.startsAt);
  if (!startsAt) return fail("Enter a valid start date and time.", "startsAt");
  const endsAt = parseLocalDateTime(v.endsAt);
  if (!endsAt) return fail("Enter a valid end date and time.", "endsAt");
  if (endsAt.getTime() <= startsAt.getTime()) return fail("The end must be after the start.", "endsAt");
  if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_MS) return fail("An event can be at most 24 hours long.", "endsAt");

  let resourceId = v.resourceId;
  let locationText = v.locationText;
  let site = v.site;
  let opponent = v.opponent;

  if (v.kind === "game") {
    site = site ?? "home";
    if (site === "home") {
      if (!resourceId) return fail("Choose the facility for a home game.", "resourceId");
      locationText = null;
    } else if (site === "away") {
      if (!locationText) return fail("Enter the location for an away game.", "locationText");
      resourceId = null;
    } else if (!resourceId && !locationText) {
      return fail("Choose a facility or enter a location.", "locationText");
    }
  } else {
    site = null;
    opponent = null;
    if (!resourceId && !locationText) return fail("Choose a facility or enter a location.", "locationText");
  }
  if (resourceId) locationText = null;

  let recurrence = v.recurrence;
  if (recurrence) {
    if (v.kind !== "practice") return fail("Only practices can repeat.", "recurrence");
    const startDate = v.startsAt.slice(0, 10);
    if (recurrence.until < startDate) return fail("The repeat must end on or after the first practice.", "recurrence");
    if (occurrenceDates(startDate, recurrence).length === 0) return fail("No practice falls on the weekdays you picked before the end date.", "recurrence");
    if (occurrenceDates(startDate, recurrence).length > MAX_SERIES_OCCURRENCES) {
      return fail(`A repeat can create at most ${MAX_SERIES_OCCURRENCES} practices. Shorten the end date.`, "recurrence");
    }
    recurrence = { weekdays: recurrence.weekdays, until: recurrence.until };
  }

  return {
    kind: v.kind,
    startsAt,
    endsAt,
    startLocal: v.startsAt,
    endLocal: v.endsAt,
    resourceId,
    locationText,
    title: v.title,
    notes: v.notes,
    opponent,
    site,
    recurrence,
  };
});

/** Calendar dates (YYYY-MM-DD, LA) from startDate through until whose weekday is selected. Bounded scan. */
export function occurrenceDates(startDate: string, rec: { weekdays: number[]; until: string }): string[] {
  const out: string[] = [];
  const span = Math.min(daysBetweenYmd(startDate, rec.until), 366 * 3);
  for (let i = 0; i <= span; i++) {
    const d = addDaysYmd(startDate, i);
    if (rec.weekdays.includes(weekdayOfYmd(d))) out.push(d);
  }
  return out;
}

export interface Occurrence {
  date: string;
  /** null when the wall-clock time does not exist that day (DST gap). */
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Expand a recurring practice. Each occurrence keeps the same LA wall-clock start
 * and end times (and the same end-day offset), so a 5:30 PM practice stays 5:30 PM
 * across the DST change; the UTC instants shift by an hour.
 */
export function expandOccurrences(input: ParsedTeamEventInput): Occurrence[] {
  if (!input.recurrence) return [{ date: input.startLocal.slice(0, 10), startsAt: input.startsAt, endsAt: input.endsAt }];
  const startDate = input.startLocal.slice(0, 10);
  const startTime = input.startLocal.slice(11);
  const endTime = input.endLocal.slice(11);
  const endDayOffset = daysBetweenYmd(startDate, input.endLocal.slice(0, 10));
  return occurrenceDates(startDate, input.recurrence).map((date) => ({
    date,
    startsAt: parseLocalDateTime(`${date}T${startTime}`),
    endsAt: parseLocalDateTime(`${addDaysYmd(date, endDayOffset)}T${endTime}`),
  }));
}

export const cancelScopeSchema = z.enum(["one", "future"], { error: "Choose what to cancel." });

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** FormData -> raw input for createTeamEvent / updateTeamEvent (validated inside the DAL). */
export function teamEventInputFromForm(fd: FormData) {
  const repeats = str(fd, "repeats") === "on" || str(fd, "repeats") === "true";
  const weekdays = fd
    .getAll("weekday")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));
  return {
    kind: str(fd, "kind"),
    startsAt: str(fd, "startsAt"),
    endsAt: str(fd, "endsAt"),
    resourceId: str(fd, "resourceId"),
    locationText: str(fd, "locationText"),
    title: str(fd, "title"),
    notes: str(fd, "notes"),
    opponent: str(fd, "opponent"),
    site: str(fd, "site") || null,
    recurrence: repeats ? { weekdays, until: str(fd, "until") } : null,
  };
}

export type TeamEventInput = ReturnType<typeof teamEventInputFromForm>;

/** Default list title when `title` is empty. */
export function deriveEventTitle(e: {
  kind: "practice" | "game" | "event";
  title: string | null;
  opponent: string | null;
  site: "home" | "away" | "neutral" | null;
}): string {
  if (e.title) return e.title;
  if (e.kind === "practice") return "Practice";
  if (e.kind === "game") return e.opponent ? `${e.site === "away" ? "at" : "vs"} ${e.opponent}` : "Game";
  return "Event";
}
