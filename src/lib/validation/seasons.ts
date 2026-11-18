import { z } from "zod";
import { customFormSchemaSchema } from "@/lib/custom-form";

// Client-safe: no server-only imports (used by forms, actions and the DAL).

export const SEASON_STATUSES = ["draft", "scheduled", "open", "closed", "inactive"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const SEASON_STATUS_LABELS: Record<SeasonStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
  inactive: "Inactive",
};

/**
 * Season status at `now` (instants are absolute, so "LA time" only matters when
 * the dates were entered; comparison is on UTC instants).
 * - inactive: switched off
 * - draft: no registration opening date or no waiver chosen yet
 * - scheduled: opens in the future
 * - closed: closing time has passed
 * - open: accepting registrations
 */
export function computeSeasonStatus(
  s: {
    isActive: boolean;
    waiverVersionId: string | null;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
  },
  now: Date = new Date()
): SeasonStatus {
  if (!s.isActive) return "inactive";
  if (!s.waiverVersionId || !s.registrationOpensAt) return "draft";
  if (now < s.registrationOpensAt) return "scheduled";
  if (s.registrationClosesAt && now >= s.registrationClosesAt) return "closed";
  return "open";
}

const uuid = z.string().uuid("Invalid identifier.");
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validYmd(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const isDateTime = (v: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) && validYmd(v.slice(0, 10)) && +v.slice(11, 13) < 24 && +v.slice(14, 16) < 60;

/** "" / undefined / null -> null, otherwise must satisfy `ok`. */
const optional = (ok: (v: string) => boolean, message: string) =>
  z
    .string()
    .nullish()
    .transform((v) => (v == null || v.trim() === "" ? null : v.trim()))
    .refine((v) => v === null || ok(v), message);

const optionalDate = (label: string) => optional(validYmd, `${label} must be a valid date.`);
const optionalDateTime = (label: string) => optional(isDateTime, `${label} must be a valid date and time.`);

/** Dollars ("12", "12.5", "12.50") -> integer cents. */
const feeField = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v == null ? "" : String(v).trim().replace(/^\$/, "")))
  .transform((v) => (v === "" ? "0" : v))
  .refine((v) => /^\d{1,5}(\.\d{1,2})?$/.test(v), "Enter the fee in dollars, like 45 or 45.50 (max $99,999.99).")
  .transform((v) => Math.round(Number(v) * 100));

export const seasonInputSchema = z
  .object({
    name: z.string().trim().min(1, "Season name is required.").max(120, "Season name is too long (max 120 characters)."),
    description: z
      .string()
      .trim()
      .max(2000, "Description is too long (max 2000 characters).")
      .nullish()
      .transform((v) => (v ? v : null)),
    startsOn: optionalDate("Season start"),
    endsOn: optionalDate("Season end"),
    registrationOpensAt: optionalDateTime("Registration opens"),
    registrationClosesAt: optionalDateTime("Registration closes"),
    eligibleBirthDateFrom: optionalDate("Earliest birth date"),
    eligibleBirthDateTo: optionalDate("Latest birth date"),
    feeDollars: feeField,
    customFormSchema: customFormSchemaSchema.default([]),
    waiverVersionId: optional((v) => uuidRe.test(v), "Invalid waiver."),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.registrationOpensAt && v.registrationClosesAt && v.registrationClosesAt <= v.registrationOpensAt) {
      ctx.addIssue({ code: "custom", message: "Registration must close after it opens." });
    }
    if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) {
      ctx.addIssue({ code: "custom", message: "The season can't end before it starts." });
    }
    if (v.eligibleBirthDateFrom && v.eligibleBirthDateTo && v.eligibleBirthDateTo < v.eligibleBirthDateFrom) {
      ctx.addIssue({ code: "custom", message: "The latest eligible birth date can't be before the earliest." });
    }
    if (v.registrationOpensAt && !v.waiverVersionId) {
      ctx.addIssue({ code: "custom", message: "Choose a waiver before setting a registration opening date." });
    }
  })
  .transform(({ feeDollars, ...rest }) => ({ ...rest, baseFeeCents: feeDollars }));

export type SeasonInput = z.input<typeof seasonInputSchema>;
export type SeasonData = z.output<typeof seasonInputSchema>;

export const DRAFT_WAIVER_MARKER = "DRAFT TEMPLATE";

export const waiverVersionInputSchema = z.object({
  programId: z
    .string()
    .nullish()
    .transform((v) => (v == null || v.trim() === "" ? null : v.trim()))
    .pipe(z.union([z.null(), uuid])),
  title: z.string().trim().min(1, "Waiver title is required.").max(160, "Waiver title is too long (max 160 characters)."),
  version: z.string().trim().min(1, "Version label is required (for example v1).").max(40, "Version label is too long (max 40 characters)."),
  body: z
    .string()
    .min(1, "Waiver text is required.")
    .max(60000, "Waiver text is too long.")
    .refine((b) => b.trim().length >= 50, "Waiver text is too short to be a waiver.")
    .refine((b) => !b.toUpperCase().includes(DRAFT_WAIVER_MARKER), "Edit the template before saving"),
});

export type WaiverVersionInput = z.input<typeof waiverVersionInputSchema>;

const fdStr = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Reads the season editor's FormData into the DAL input shape (zod runs in the DAL). */
export function seasonInputFromForm(fd: FormData): SeasonInput {
  let customFormSchema: unknown = [];
  try {
    customFormSchema = JSON.parse(fdStr(fd, "customFormSchema") || "[]");
  } catch {
    customFormSchema = null; // fails validation with a generic message
  }
  return {
    name: fdStr(fd, "name"),
    description: fdStr(fd, "description"),
    startsOn: fdStr(fd, "startsOn"),
    endsOn: fdStr(fd, "endsOn"),
    registrationOpensAt: fdStr(fd, "registrationOpensAt"),
    registrationClosesAt: fdStr(fd, "registrationClosesAt"),
    eligibleBirthDateFrom: fdStr(fd, "eligibleBirthDateFrom"),
    eligibleBirthDateTo: fdStr(fd, "eligibleBirthDateTo"),
    feeDollars: fdStr(fd, "feeDollars"),
    customFormSchema: customFormSchema as SeasonInput["customFormSchema"],
    waiverVersionId: fdStr(fd, "waiverVersionId"),
    isActive: fd.get("isActive") === "on",
  };
}
