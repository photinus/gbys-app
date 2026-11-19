import { z } from "zod";
import { normalizePhone } from "@/lib/validation/household";

// Client-safe types + core-field validation for the public contact form.

export type ContactSubmitErrorCode = "not_available" | "unavailable" | "invalid" | "verification" | "rate_limited";

export type ContactSubmitResult =
  | { ok: true; data: { successMessage: string } }
  | { ok: false; code: ContactSubmitErrorCode; error: string; fieldErrors?: Record<string, string> };

export interface PublicContactForm {
  id: string;
  slug: string;
  title: string;
  intro: string | null;
  collectPhone: boolean;
  phoneRequired: boolean;
  fields: import("@/lib/custom-form").CustomFormField[];
  submitLabel: string;
  successMessage: string;
  privacyNote: string | null;
}

export interface ContactSubmitInput {
  slug: string;
  name: unknown;
  email: unknown;
  phone?: unknown;
  message: unknown;
  answers?: unknown;
  /** Honeypot: must be empty. */
  website?: unknown;
  turnstileToken?: unknown;
  /** Client-sent document.referrer (embed page's parent). */
  referrer?: unknown;
}

export interface ContactSubmitMeta {
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
  host: string | null;
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Core fields (name, email, message always; phone per form settings). */
export function buildCoreSchema(opts: { collectPhone: boolean; phoneRequired: boolean }) {
  return z.object({
    name: z.string({ message: "Enter your name." }).trim().min(1, "Enter your name.").max(120, "Name is too long (120 characters max)."),
    email: z
      .string({ message: "Enter your email." })
      .trim()
      .toLowerCase()
      .min(1, "Enter your email.")
      .max(254, "Email is too long.")
      .email("Enter a valid email address."),
    phone: z
      .unknown()
      .transform((v, ctx): string | null => {
        if (!opts.collectPhone) return null;
        const s = typeof v === "string" ? v.trim() : "";
        if (!s) {
          if (opts.phoneRequired) ctx.addIssue({ code: "custom", message: "Phone number is required." });
          return null;
        }
        const n = s.length <= 40 ? normalizePhone(s) : null;
        if (!n) {
          ctx.addIssue({ code: "custom", message: "Enter a valid phone number, like (541) 555-0123." });
          return z.NEVER;
        }
        return n;
      }),
    message: z
      .string({ message: "Enter a message." })
      .trim()
      .min(1, "Enter a message.")
      .max(5000, "Message is too long (5000 characters max)."),
  });
}
