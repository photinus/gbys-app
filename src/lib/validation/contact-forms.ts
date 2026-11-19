import { z } from "zod";
import { customFormSchemaSchema, type CustomFormField } from "@/lib/custom-form";

// Client-safe (no server-only imports): used by the editor, inbox, actions and the DAL.

export const CONTACT_MAX_FIELDS = 15;
export const CONTACT_MAX_RECIPIENTS = 10;
export const CONTACT_PAGE_SIZE = 50;

export const SUBMISSION_STATUSES = ["new", "read", "archived", "spam"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  new: "New",
  read: "Read",
  archived: "Archived",
  spam: "Spam",
};

/** Inbox status filter: a single status, "open" (new + read, the default) or "all". */
export const STATUS_FILTERS = ["open", "new", "read", "archived", "spam", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  open: "Inbox (new + read)",
  new: "New",
  read: "Read",
  archived: "Archived",
  spam: "Spam",
  all: "All",
};

export const slugSchema = z
  .string()
  .trim()
  .min(3, "The URL name needs at least 3 characters.")
  .max(60, "The URL name can be at most 60 characters.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens (like youth-wrestling).");

/** Suggest a URL slug from a title ("Contact Gold Beach Wrestling!" -> "contact-gold-beach-wrestling"). */
export function suggestSlug(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s;
}

const optText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter valid email addresses."));

export const recipientEmailsSchema = z
  .array(emailSchema)
  .max(CONTACT_MAX_RECIPIENTS, `Add at most ${CONTACT_MAX_RECIPIENTS} recipients.`)
  .transform((l) => [...new Set(l)]);

export const contactFormFieldsSchema = customFormSchemaSchema.refine((f) => f.length <= CONTACT_MAX_FIELDS, {
  message: `A contact form can have at most ${CONTACT_MAX_FIELDS} extra questions.`,
});

const uuid = z.string().uuid();

export const contactFormInputSchema = z
  .object({
    /** Create only. On update it must be absent or equal to the existing value (a form never moves programs). */
    programId: z.union([uuid, z.literal(""), z.null()]).optional(),
    slug: slugSchema,
    title: z.string().trim().min(1, "Give the form a title.").max(120, "The title can be at most 120 characters."),
    intro: optText(1000, "The intro can be at most 1000 characters."),
    collectPhone: z.boolean(),
    phoneRequired: z.boolean(),
    fields: contactFormFieldsSchema,
    recipientEmails: recipientEmailsSchema,
    notifyProgramAdmins: z.boolean(),
    submitLabel: z.string().trim().min(1, "The submit button needs a label.").max(40, "The submit label can be at most 40 characters."),
    successMessage: z.string().trim().min(1, "Write a thank-you message.").max(500, "The success message can be at most 500 characters."),
    privacyNote: optText(500, "The privacy note can be at most 500 characters."),
    isActive: z.boolean(),
  })
  .refine((v) => v.collectPhone || !v.phoneRequired, {
    message: "Phone can't be required unless it is collected.",
    path: ["phoneRequired"],
  });

export type ContactFormInput = z.input<typeof contactFormInputSchema>;
export type ParsedContactFormInput = z.output<typeof contactFormInputSchema>;

/** Names of editable fields (for audit metadata). */
export const CONTACT_FORM_FIELD_NAMES = [
  "slug",
  "title",
  "intro",
  "collectPhone",
  "phoneRequired",
  "fields",
  "recipientEmails",
  "notifyProgramAdmins",
  "submitLabel",
  "successMessage",
  "privacyNote",
  "isActive",
] as const;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";
function json<T>(fd: FormData, key: string, fallback: T): T {
  const raw = str(fd, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** FormData -> raw input (validated by the DAL). */
export function contactFormInputFromForm(fd: FormData): ContactFormInput {
  return {
    programId: str(fd, "programId") || null,
    slug: str(fd, "slug"),
    title: str(fd, "title"),
    intro: str(fd, "intro"),
    collectPhone: bool(fd, "collectPhone"),
    phoneRequired: bool(fd, "phoneRequired"),
    fields: json<CustomFormField[]>(fd, "fields", []),
    recipientEmails: json<string[]>(fd, "recipientEmails", []),
    notifyProgramAdmins: bool(fd, "notifyProgramAdmins"),
    submitLabel: str(fd, "submitLabel"),
    successMessage: str(fd, "successMessage"),
    privacyNote: str(fd, "privacyNote"),
    isActive: bool(fd, "isActive"),
  };
}

// ---- Inbox ----------------------------------------------------------------

export const inboxFiltersSchema = z.object({
  formId: z.union([uuid, z.literal("")]).optional().transform((v) => (v ? v : undefined)),
  status: z.enum(STATUS_FILTERS).optional(),
  q: z
    .string()
    .trim()
    .max(100, "Search is too long (max 100 characters).")
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type InboxFilters = z.output<typeof inboxFiltersSchema>;

/** Keyset cursor: full-precision UTC timestamp (Postgres keeps microseconds) + id. */
const cursorSchema = z
  .string()
  .max(80)
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid cursor."
  );

export function parseSubmissionCursor(cursor: string): { ts: string; id: string } {
  const c = cursorSchema.parse(cursor);
  const [ts, id] = c.split("|");
  return { ts, id: id.toLowerCase() };
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
function first(params: Params, key: string): string | undefined {
  const raw = params instanceof URLSearchParams ? params.get(key) : params[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === null || v === undefined ? undefined : v;
}

/** Lenient URL parsing: bad values fall back to "no filter". */
export function parseInboxFilters(params: Params): InboxFilters {
  const res = inboxFiltersSchema.safeParse({
    formId: first(params, "form"),
    status: first(params, "status") || undefined,
    q: first(params, "q"),
  });
  if (res.success) return res.data;
  const q = first(params, "q")?.trim().slice(0, 100);
  return { formId: undefined, status: undefined, q: q || undefined };
}

export function inboxFiltersToQuery(f: InboxFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.formId) q.set("form", f.formId);
  if (f.status && f.status !== "open") q.set("status", f.status);
  if (f.q) q.set("q", f.q);
  return q;
}
