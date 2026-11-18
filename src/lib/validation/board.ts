import { z } from "zod";

// Client-safe: no server-only imports (used by forms, actions, the DAL and components).

const uuid = z.string().uuid("Invalid identifier.");
export const boardIdSchema = uuid;

/** "" / null / undefined -> null, otherwise trimmed string. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .nullish()
    .transform((v) => (v ? v : null));

const ymd = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date.`)
    .refine((v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    }, `${label} must be a real date.`);

const optionalYmd = (label: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.union([z.null(), ymd(label)]));

/** `<input type="datetime-local">` value, Pacific wall clock. */
const localDateTime = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `${label} must be a date and time.`)
    .refine((v) => !Number.isNaN(new Date(`${v}:00Z`).getTime()), `${label} must be a real date and time.`);

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------
/** Fallback when org_settings has no row. The live list is org_settings.board_positions. */
export const DEFAULT_BOARD_POSITIONS: readonly string[] = ["President", "Vice President", "Secretary", "Treasurer", "Director"];

export const POSITION_MIN = 2;
export const POSITION_MAX = 60;
export const POSITIONS_MAX_COUNT = 30;

/** Configurable seat titles: trimmed, 2-60 chars, case-insensitively unique, 1-30 entries, order kept. */
export const positionListSchema = z
  .array(
    z
      .string()
      .trim()
      .min(POSITION_MIN, `Each position needs at least ${POSITION_MIN} characters.`)
      .max(POSITION_MAX, `Each position can be at most ${POSITION_MAX} characters.`)
  )
  .min(1, "Keep at least one position.")
  .max(POSITIONS_MAX_COUNT, `You can have at most ${POSITIONS_MAX_COUNT} positions.`)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const p of list) {
      const k = p.toLowerCase();
      if (seen.has(k)) {
        ctx.addIssue({ code: "custom", message: `"${p}" appears twice. Positions must be unique.` });
        return;
      }
      seen.add(k);
    }
  });

/** Sort key: configured order first; unknown positions after, alphabetical. */
export function comparePositions(a: string, b: string, order: readonly string[]): number {
  const idx = (p: string) => order.findIndex((o) => o.toLowerCase() === p.toLowerCase());
  const ia = idx(a);
  const ib = idx(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

export function samePosition(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const memberInputSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "Email is too long.")
      .nullish()
      .transform((v) => (v ? v : null))
      .pipe(z.union([z.null(), z.string().email("Enter a valid email address, or leave it blank.")])),
    displayName: z.string().trim().min(2, "Enter the director's name.").max(100, "Name is too long (max 100 characters)."),
    position: z.string().trim().min(2, "Choose or enter a position, like President or Director.").max(80, "Position is too long (max 80 characters)."),
    isVotingDirector: z.boolean(),
    termStart: ymd("Term start"),
    termEnd: optionalYmd("Term end"),
    electedOn: optionalYmd("Elected on"),
    notes: optionalText(2000, "Notes"),
  })
  .refine((v) => v.termEnd === null || v.termEnd >= v.termStart, {
    message: "Term end can't be before the term start.",
    path: ["termEnd"],
  });
export type MemberInput = z.input<typeof memberInputSchema>;
export type MemberValues = z.output<typeof memberInputSchema>;

export const endSeatSchema = z.object({
  endedAt: ymd("Effective date"),
  reason: z.string().trim().min(2, "Give a short reason (resignation, removal, ...).").max(500, "Reason is too long (max 500 characters)."),
});
export type EndSeatInput = z.input<typeof endSeatSchema>;

export const listMembersSchema = z.object({ include: z.enum(["current", "all"]).default("current") });

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function memberInputFromForm(fd: FormData): MemberInput {
  return {
    email: str(fd, "email"),
    displayName: str(fd, "displayName"),
    position: str(fd, "position"),
    isVotingDirector: fd.get("isVotingDirector") === "on" || fd.get("isVotingDirector") === "true",
    termStart: str(fd, "termStart"),
    termEnd: str(fd, "termEnd"),
    electedOn: str(fd, "electedOn"),
    notes: str(fd, "notes"),
  };
}

// ---- term badges ---------------------------------------------------------------
export type SeatTermStatus = "current" | "upcoming" | "ended";
export const TERM_WARNING_DAYS = 60;

export interface SeatTermInfo {
  termStart: string;
  termEnd: string | null;
  endedAt: Date | null;
}

function dayNumber(s: string): number {
  return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000);
}

/**
 * Term status as of `today` (an LA YYYY-MM-DD) and `now`. `daysLeft` is the whole
 * calendar days until the last term day (set for current seats with a term end).
 */
export function seatTermStatus(seat: SeatTermInfo, today: string, now: Date): { status: SeatTermStatus; daysLeft: number | null } {
  if (seat.endedAt && seat.endedAt.getTime() <= now.getTime()) return { status: "ended", daysLeft: null };
  if (seat.termEnd && seat.termEnd < today) return { status: "ended", daysLeft: null };
  if (seat.termStart > today) return { status: "upcoming", daysLeft: null };
  return { status: "current", daysLeft: seat.termEnd ? dayNumber(seat.termEnd) - dayNumber(today) : null };
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------
export const MEETING_KINDS = ["regular", "special", "annual"] as const;
export const MEETING_KIND_LABELS: Record<(typeof MEETING_KINDS)[number], string> = {
  regular: "Regular meeting",
  special: "Special meeting",
  annual: "Annual meeting",
};
export const MEETING_STATUS_LABELS = { scheduled: "Scheduled", held: "Held", cancelled: "Cancelled" } as const;

export const ATTENDANCE_STATUSES = ["present", "remote", "absent", "excused"] as const;
export const ATTENDANCE_LABELS: Record<(typeof ATTENDANCE_STATUSES)[number], string> = {
  present: "Present",
  remote: "Remote",
  absent: "Absent",
  excused: "Excused",
};

/** http(s) only: members see this link, so never allow javascript:, data:, etc. */
const httpUrl = z
  .string()
  .trim()
  .max(500, "Link is too long (max 500 characters).")
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (v === null) return true;
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a full web link starting with https://, or leave it blank.");

export const meetingInputSchema = z
  .object({
    title: z.string().trim().min(2, "Enter a title.").max(120, "Title is too long (max 120 characters)."),
    kind: z.enum(MEETING_KINDS, { message: "Choose a meeting type." }),
    startsAt: localDateTime("Start").transform((v) => v),
    endsAt: z
      .string()
      .trim()
      .nullish()
      .transform((v) => (v ? v : null))
      .pipe(z.union([z.null(), localDateTime("End")])),
    location: optionalText(200, "Location"),
    virtualUrl: httpUrl,
    agenda: optionalText(20000, "Agenda"),
    isPublic: z.boolean(),
  })
  .refine((v) => v.endsAt === null || v.endsAt > v.startsAt, {
    message: "The end time must be after the start time.",
    path: ["endsAt"],
  });
export type MeetingInput = z.input<typeof meetingInputSchema>;
export type MeetingValues = z.output<typeof meetingInputSchema>;

export function meetingInputFromForm(fd: FormData): MeetingInput {
  return {
    title: str(fd, "title"),
    kind: str(fd, "kind") as MeetingInput["kind"],
    startsAt: str(fd, "startsAt"),
    endsAt: str(fd, "endsAt"),
    location: str(fd, "location"),
    virtualUrl: str(fd, "virtualUrl"),
    agenda: str(fd, "agenda"),
    isPublic: fd.get("isPublic") === "on" || fd.get("isPublic") === "true",
  };
}

export const listMeetingsSchema = z.object({ range: z.enum(["upcoming", "past", "all"]).default("all") });

export const attendanceEntriesSchema = z
  .array(z.object({ boardMemberId: uuid, status: z.enum(ATTENDANCE_STATUSES, { message: "Choose an attendance status." }) }))
  .max(100, "Too many entries.")
  .refine((rows) => new Set(rows.map((r) => r.boardMemberId)).size === rows.length, "A seat appears twice.");
export type AttendanceEntry = z.input<typeof attendanceEntriesSchema>[number];

// ---------------------------------------------------------------------------
// Minutes
// ---------------------------------------------------------------------------
export const MINUTES_MAX_CHARS = 100_000;
export const minutesBodySchema = z
  .string()
  .max(MINUTES_MAX_CHARS, `Minutes are too long (max ${MINUTES_MAX_CHARS.toLocaleString("en-US")} characters).`)
  .refine((v) => v.trim().length > 0, "Write the minutes before saving.");

export const approveMinutesSchema = z.object({ motionId: uuid.nullish().transform((v) => v ?? null) }).default({ motionId: null });
