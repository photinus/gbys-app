import { z } from "zod";
import { laDateTimeInputToUtc, utcToLaDateTimeInput } from "@/lib/format";
import { VOLUNTEER_CATEGORIES } from "@/lib/volunteer-categories";

const MAX_SHIFT_MS = 24 * 60 * 60 * 1000;
const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const uuidSchema = z.string().uuid("Invalid identifier.");

/** datetime-local string (Pacific wall clock) -> UTC Date, or null when not a real local time. */
function parseLocal(value: string): Date | null {
  if (!LOCAL_DT.test(value)) return null;
  const d = laDateTimeInputToUtc(value);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip catches rollovers such as Feb 31 and the nonexistent spring-forward hour.
  return utcToLaDateTimeInput(d) === value ? d : null;
}

/**
 * Create / edit shift form. Input: raw form strings (datetime-local values are
 * America/Los_Angeles wall clock). Output: UTC Dates, programId null = org-wide.
 */
export const shiftSchema = z
  .object({
    programId: z
      .string()
      .trim()
      .transform((v) => (v === "" || v === "org" ? null : v))
      .pipe(z.string().uuid("Choose a valid program.").nullable()),
    title: z.string().trim().min(1, "Title is required.").max(120, "Title is too long (120 max)."),
    description: z
      .string()
      .trim()
      .max(1000, "Description is too long (1000 max).")
      .transform((v) => v || null),
    location: z
      .string()
      .trim()
      .max(160, "Location is too long (160 max).")
      .transform((v) => v || null),
    category: z.enum(VOLUNTEER_CATEGORIES, { error: "Choose a category." }),
    startsAt: z.string().trim(),
    endsAt: z.string().trim(),
    spotsTotal: z.coerce
      .number({ error: "Spots must be a number." })
      .int("Spots must be a whole number.")
      .min(1, "At least 1 spot is required.")
      .max(500, "Spots can be at most 500."),
  })
  .transform((v, ctx) => {
    const startsAt = parseLocal(v.startsAt);
    const endsAt = parseLocal(v.endsAt);
    if (!startsAt) ctx.addIssue({ code: "custom", path: ["startsAt"], message: "Enter a valid start time." });
    if (!endsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Enter a valid end time." });
    if (!startsAt || !endsAt) return z.NEVER;
    if (endsAt <= startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be after the start time." });
      return z.NEVER;
    }
    if (endsAt.getTime() - startsAt.getTime() > MAX_SHIFT_MS) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "A shift can be at most 24 hours long." });
      return z.NEVER;
    }
    return { ...v, startsAt, endsAt };
  });
export type ShiftFormInput = z.input<typeof shiftSchema>;
export type ShiftInput = z.output<typeof shiftSchema>;

export const undoReasonSchema = z
  .string()
  .trim()
  .min(3, "Enter a reason (at least 3 characters).")
  .max(500, "Reason is too long (500 max).");

export const walkInEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254, "Email is too long.");
