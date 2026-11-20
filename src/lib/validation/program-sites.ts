import { z } from "zod";
import { accentIsAccessible, normalizeHex } from "@/lib/color";
import { RESERVED_PATH_SEGMENTS, isValidPathSlug, parseCustomDomain } from "@/lib/site-hosts";

// Client-safe: no server-only imports (used by the editor, actions and the DAL).

export const SITE_LIMITS = {
  headline: 120,
  tagline: 200,
  about: 5000,
  seoDescription: 300,
  email: 254,
  phone: 30,
  sections: 20,
  items: 30,
  sectionTitle: 120,
  textBody: 5000,
  faqQuestion: 200,
  faqAnswer: 2000,
  linkLabel: 100,
  linkUrl: 500,
} as const;

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const HERO_MAX_WIDTH = 1920;
export const LOGO_MAX_SIZE = 512;

export const SECTION_KINDS = ["text", "faq", "links"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  text: "Text block",
  faq: "Questions & answers",
  links: "Links",
};

// Strip control characters (keep newline and tab) and normalise line endings.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export function cleanText(v: string): string {
  return v.replace(/\r\n?/g, "\n").replace(CONTROL_RE, "");
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .transform((v) => cleanText(v).trim())
    .pipe(z.string().max(max, `${label} is too long (max ${max} characters).`))
    .transform((v) => (v === "" ? null : v));

const requiredText = (max: number, label: string) =>
  z
    .string()
    .transform((v) => cleanText(v).trim())
    .pipe(z.string().min(1, `${label} can't be empty.`).max(max, `${label} is too long (max ${max} characters).`));

const PHONE_RE = /^[0-9+()\-.\sx#]{5,30}$/i;

/** http(s) and mailto links only. Returns the normalised URL, or null when not allowed. */
export function normalizeLinkUrl(raw: string): string | null {
  const s = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > SITE_LIMITS.linkUrl || /[\u0000-\u001f\u007f\s]/.test(s)) return null;
  if (/^mailto:/i.test(s)) {
    const addr = s.slice(7);
    return /^[^\s@<>"',;:?&]+@[^\s@<>"',;:?&]+\.[^\s@<>"',;:?&]+$/.test(addr) ? `mailto:${addr}` : null;
  }
  // No scheme at all ("example.org/page"): assume https. Any other scheme (javascript:, data:, ftp:) is refused.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//") ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
  return u.href;
}

export const ACCENT_ERROR =
  "That color doesn't give button text enough contrast. Pick a darker or lighter shade, or one of the presets.";

export function validateAccent(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const hex = normalizeHex(raw);
  if (!hex) return { ok: false, error: "Enter a color like #1d4ed8 (six hex digits)." };
  if (!accentIsAccessible(hex)) return { ok: false, error: ACCENT_ERROR };
  return { ok: true, value: hex };
}

/** Lowercase, trim, drop surrounding slashes. "" -> null. */
export function validatePath(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = raw.trim().toLowerCase().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!s) return { ok: true, value: null };
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(s)) {
    return {
      ok: false,
      error: "Use only letters, numbers and dashes (up to 64 characters), starting and ending with a letter or number.",
    };
  }
  if (RESERVED_PATH_SEGMENTS.has(s) || !isValidPathSlug(s)) {
    return { ok: false, error: `"${s}" is already used by the GBYS app. Please choose a different address.` };
  }
  return { ok: true, value: s };
}

/** Server-side only (primary hosts come from env). "" -> null. */
export function validateDomain(raw: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  const d = parseCustomDomain(s);
  if (!d) {
    return {
      ok: false,
      error: "Enter just the domain, like ripkenbaseball.org. It can't be an IP address or the GBYS app's own address.",
    };
  }
  return { ok: true, value: d };
}

// ---- Content -------------------------------------------------------------------------------

export const contentSchema = z.object({
  headline: optionalText(SITE_LIMITS.headline, "Headline"),
  tagline: optionalText(SITE_LIMITS.tagline, "Tagline"),
  about: optionalText(SITE_LIMITS.about, "About text"),
  showOpenRegistrations: z.boolean(),
  contactEmail: z
    .string()
    .trim()
    .max(SITE_LIMITS.email, "Contact email is too long.")
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid contact email."),
  contactPhone: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || PHONE_RE.test(v), "Enter a valid phone number (digits, spaces, dashes and + only)."),
  contactFormId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v), "Pick a contact form from the list."),
  seoDescription: optionalText(SITE_LIMITS.seoDescription, "Search description"),
});
export type ContentInput = z.input<typeof contentSchema>;
export type ContentData = z.output<typeof contentSchema>;

const fdStr = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const fdBool = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
};

export function contentInputFromForm(fd: FormData): ContentInput & { showOpenRegistrations: boolean } {
  return {
    headline: fdStr(fd, "headline"),
    tagline: fdStr(fd, "tagline"),
    about: fdStr(fd, "about"),
    showOpenRegistrations: fdBool(fd, "showOpenRegistrations"),
    contactEmail: fdStr(fd, "contactEmail"),
    contactPhone: fdStr(fd, "contactPhone"),
    contactFormId: fdStr(fd, "contactFormId"),
    seoDescription: fdStr(fd, "seoDescription"),
  };
}

// ---- Sections --------------------------------------------------------------------------------

const urlField = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "Every link needs a web address.").max(SITE_LIMITS.linkUrl, "A link address is too long."))
  .transform((v, ctx) => {
    const n = normalizeLinkUrl(v);
    if (!n) {
      ctx.addIssue({
        code: "custom",
        message: `"${v.slice(0, 60)}" isn't an allowed link. Use a web address starting with http:// or https://, or an email as mailto:name@example.org.`,
      });
      return z.NEVER;
    }
    return n;
  });

const sectionId = z.string().max(40).optional().default("");
const sectionTitle = requiredText(SITE_LIMITS.sectionTitle, "Each block's title");
const itemsMax = (label: string) =>
  `A ${label} can have at most ${SITE_LIMITS.items} items.`;

export const sectionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: sectionId,
    kind: z.literal("text"),
    title: sectionTitle,
    body: requiredText(SITE_LIMITS.textBody, "The text"),
  }),
  z.object({
    id: sectionId,
    kind: z.literal("faq"),
    title: sectionTitle,
    items: z
      .array(
        z.object({
          q: requiredText(SITE_LIMITS.faqQuestion, "Each question"),
          a: requiredText(SITE_LIMITS.faqAnswer, "Each answer"),
        })
      )
      .min(1, "Add at least one question, or remove the block.")
      .max(SITE_LIMITS.items, itemsMax("Q&A block")),
  }),
  z.object({
    id: sectionId,
    kind: z.literal("links"),
    title: sectionTitle,
    items: z
      .array(z.object({ label: requiredText(SITE_LIMITS.linkLabel, "Each link's label"), url: urlField }))
      .min(1, "Add at least one link, or remove the block.")
      .max(SITE_LIMITS.items, itemsMax("links block")),
  }),
]);

export const sectionsSchema = z
  .array(sectionSchema)
  .max(SITE_LIMITS.sections, `A home page can have at most ${SITE_LIMITS.sections} blocks.`);
export type SectionsInput = z.input<typeof sectionsSchema>;
export type SectionDraft = z.output<typeof sectionSchema>;

/** Parse the editor's JSON payload. Throws a ZodError-friendly message through the caller. */
export function parseSectionsJson(raw: string): unknown {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return null;
  }
}
