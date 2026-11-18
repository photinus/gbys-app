import { z } from "zod";
import { utcToLaDateInput } from "@/lib/format";

// ---------------------------------------------------------------------------
// Phone helpers (E.164-ish). Stored normalized as +<digits>; US numbers without
// a country code get +1.
// ---------------------------------------------------------------------------
const PHONE_MSG = "Enter a valid phone number, e.g. (541) 555-0123.";

/** Returns an E.164 string, or null when the input is not a plausible phone number. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  if (!/^[+\d\s().-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  let e164: string;
  if (s.startsWith("+")) e164 = `+${digits}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** Display helper: +15415550123 -> (541) 555-0123; anything else is returned as-is. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

const phoneRequired = z
  .string({ error: "Phone number is required." })
  .trim()
  .transform((s, ctx) => {
    const n = normalizePhone(s);
    if (!n) {
      ctx.addIssue({ code: "custom", message: s ? PHONE_MSG : "Phone number is required." });
      return z.NEVER;
    }
    return n;
  });

const phoneOptional = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((s, ctx): string | null => {
    if (!s) return null;
    const n = normalizePhone(s);
    if (!n) {
      ctx.addIssue({ code: "custom", message: PHONE_MSG });
      return z.NEVER;
    }
    return n;
  });

/** Optional trimmed text: "" / undefined / null -> null. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .nullable()
    .transform((s) => (s ? s : null));
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export const profileSchema = z
  .object({
    name: z
      .string({ error: "Name is required." })
      .trim()
      .min(1, "Name is required.")
      .max(100, "Name must be 100 characters or fewer."),
    phone: phoneOptional,
    smsOptIn: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.smsOptIn && !v.phone) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Add a phone number to opt in to text messages.",
      });
    }
  });
export type ProfileInput = z.output<typeof profileSchema>;

// ---------------------------------------------------------------------------
// Athletes
// ---------------------------------------------------------------------------
const DOB_FORMAT_MSG = "Date of birth must be a valid date (YYYY-MM-DD).";

function isRealDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Date-only string; compared lexicographically against today's Pacific calendar date. */
export const dobSchema = z
  .string({ error: DOB_FORMAT_MSG })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, DOB_FORMAT_MSG)
  .refine(isRealDate, DOB_FORMAT_MSG)
  .refine((s) => s >= "1900-01-01" && s < utcToLaDateInput(new Date()), "Date of birth must be in the past.");

export const emergencyContactSchema = z.object({
  name: z
    .string({ error: "Emergency contact name is required." })
    .trim()
    .min(1, "Emergency contact name is required.")
    .max(100, "Emergency contact name must be 100 characters or fewer."),
  phone: phoneRequired,
  relationship: z
    .string({ error: "Emergency contact relationship is required." })
    .trim()
    .min(1, "Emergency contact relationship is required.")
    .max(50, "Emergency contact relationship must be 50 characters or fewer."),
});

export const athleteSchema = z.object({
  firstName: z
    .string({ error: "First name is required." })
    .trim()
    .min(1, "First name is required.")
    .max(60, "First name must be 60 characters or fewer."),
  lastName: z
    .string({ error: "Last name is required." })
    .trim()
    .min(1, "Last name is required.")
    .max(60, "Last name must be 60 characters or fewer."),
  dateOfBirth: dobSchema,
  gender: optionalText(40, "Gender"),
  gradeLevel: optionalText(20, "Grade"),
  medicalNotes: optionalText(2000, "Medical notes"),
  emergencyContacts: z
    .array(emergencyContactSchema)
    .min(1, "Add at least one emergency contact.")
    .max(5, "You can add up to 5 emergency contacts."),
  /** The creating adult's relationship to the athlete (used by createAthlete only). */
  relationship: z
    .string()
    .trim()
    .max(40, "Relationship must be 40 characters or fewer.")
    .optional()
    .nullable()
    .transform((s) => s || "Parent"),
});
export type AthleteInput = z.output<typeof athleteSchema>;

// ---------------------------------------------------------------------------
// Co-guardian invites
// ---------------------------------------------------------------------------
export const inviteSchema = z.object({
  email: z
    .string({ error: "Email is required." })
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.")),
  relationship: z
    .string({ error: "Relationship is required." })
    .trim()
    .min(1, "Relationship is required.")
    .max(40, "Relationship must be 40 characters or fewer."),
  athleteIds: z
    .array(z.uuid("Invalid athlete."))
    .min(1, "Select at least one athlete.")
    .max(50)
    .transform((ids) => [...new Set(ids)]),
  canRegister: z.boolean().default(true),
  canSignWaivers: z.boolean().default(true),
  receivesComms: z.boolean().default(true),
});
export type InviteInput = z.output<typeof inviteSchema>;
