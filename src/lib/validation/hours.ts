import { z } from "zod";
import { VOLUNTEER_CATEGORIES } from "@/lib/volunteer-categories";
import { utcToLaDateInput } from "@/lib/format";

// Client-safe (no server-only imports): used by forms and the DAL.

export const MAX_BACKDATE_DAYS = 365;
export const MAX_DESCRIPTION = 500;

const uuid = z.string().uuid("Invalid identifier.");

function isRealDate(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** YYYY-MM-DD minus N calendar days (pure calendar arithmetic, no timezone). */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Earliest and latest allowed activity dates (LA calendar) at `now`. */
export function allowedDateRange(now: Date = new Date()): { min: string; max: string } {
  const today = utcToLaDateInput(now);
  return { min: shiftYmd(today, -MAX_BACKDATE_DAYS), max: today };
}

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

export const logHoursSchema = z.object({
  programId: z.preprocess(emptyToNull, uuid.nullable()),
  category: z.enum(VOLUNTEER_CATEGORIES, { error: "Choose a category." }),
  activityDate: z
    .string({ error: "Date is required." })
    .refine(isRealDate, "Enter a valid date."),
  durationMinutes: z
    .number({ error: "Enter the time you volunteered." })
    .int("Enter the time in whole minutes.")
    .min(15, "Enter at least 15 minutes.")
    .max(1440, "A single entry can be at most 24 hours.")
    .refine((n) => n % 15 === 0, "Time must be in 15-minute steps."),
  description: z
    .string({ error: "Describe what you did." })
    .trim()
    .min(1, "Describe what you did.")
    .max(MAX_DESCRIPTION, `Description must be ${MAX_DESCRIPTION} characters or fewer.`),
});
export type LogHoursInput = z.input<typeof logHoursSchema>;

/** Date window check (kept out of the schema so `now` stays injectable for tests). */
export function assertDateInWindow(ymd: string, now: Date = new Date()): string | null {
  const { min, max } = allowedDateRange(now);
  if (ymd > max) return "Date cannot be in the future.";
  if (ymd < min) return `Date cannot be more than ${MAX_BACKDATE_DAYS} days ago.`;
  return null;
}

export const logHoursForVolunteerSchema = logHoursSchema.extend({
  email: z.string().trim().toLowerCase().email("Enter the volunteer's email address."),
});
export type LogHoursForVolunteerInput = z.input<typeof logHoursForVolunteerSchema>;

export const rejectReasonSchema = z
  .string({ error: "A reason is required." })
  .trim()
  .min(1, "A reason is required.")
  .max(300, "Reason must be 300 characters or fewer.");

export const logIdSchema = uuid;

/** Hours + minutes form fields -> total minutes (NaN-safe). */
export function toMinutes(hours: unknown, minutes: unknown): number {
  const h = Number(hours === "" || hours == null ? 0 : hours);
  const m = Number(minutes === "" || minutes == null ? 0 : minutes);
  return h * 60 + m;
}
