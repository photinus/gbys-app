import { z } from "zod";

// Client-safe: no server-only imports (used by both forms and the DAL).

export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const RATE_MIN_CENTS = 100;
export const RATE_MAX_CENTS = 50000;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .transform((v) => (v === "" ? null : v));

/** Dollars string ("33.49") -> integer cents, or null when blank. */
export function parseRateDollars(raw: string): number | null | "invalid" {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (s === "") return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return "invalid";
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents)) return "invalid";
  return cents;
}

const profileShape = {
  section: z.literal("profile"),
  orgName: z.string().trim().min(2, "Organization name must be at least 2 characters.").max(80, "Organization name is too long (max 80 characters)."),
  shortName: z.string().trim().min(2, "Short name must be at least 2 characters.").max(12, "Short name is too long (max 12 characters)."),
  legalDesignation: z.string().trim().min(1, "Legal designation is required.").max(120, "Legal designation is too long (max 120 characters)."),
  ein: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^\d{2}-\d{7}$/.test(v), "EIN must look like 12-3456789."),
  supportEmail: z
    .string()
    .trim()
    .max(254, "Support email is too long.")
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid support email."),
  websiteUrl: z
    .string()
    .trim()
    .max(300, "Website URL is too long (max 300 characters).")
    .transform((v) => (v === "" ? null : v))
    .refine((v) => {
      if (v === null) return true;
      try {
        const u = new URL(v);
        return u.protocol === "https:" && !!u.hostname.includes(".") && !u.username && !u.password;
      } catch {
        return false;
      }
    }, "Website must be a valid https:// URL."),
};

const valuationShape = {
  section: z.literal("valuation"),
  /** Dollars as typed; blank = use the default (environment) rate. */
  inKindRateDollars: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const cents = parseRateDollars(v);
      if (cents === "invalid") {
        ctx.addIssue({ code: "custom", message: "Enter the hourly rate in dollars, e.g. 33.49." });
        return z.NEVER;
      }
      if (cents !== null && (cents < RATE_MIN_CENTS || cents > RATE_MAX_CENTS)) {
        ctx.addIssue({ code: "custom", message: "Hourly rate must be between $1.00 and $500.00." });
        return z.NEVER;
      }
      return cents;
    }),
  inKindRateSource: optionalText(200, "Rate source"),
};

/** Section-scoped: each card submits only its own fields so concurrent saves cannot overwrite each other. */
export const updateSettingsSchema = z.discriminatedUnion("section", [z.object(profileShape), z.object(valuationShape)]);
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;
