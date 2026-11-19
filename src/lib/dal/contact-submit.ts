import "server-only";
import { createHmac } from "node:crypto";
import { and, count, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contactForms, contactSubmissions, programRoles, programs, users } from "@/db/schema";
import { buildAnswersSchema } from "@/lib/custom-form";
import { sendContactSubmissionEmail } from "@/lib/email";
import { getTurnstileConfig, verifyTurnstile } from "@/lib/turnstile";
import {
  SLUG_RE,
  buildCoreSchema,
  type ContactSubmitInput,
  type ContactSubmitMeta,
  type ContactSubmitResult,
  type PublicContactForm,
} from "@/lib/validation/contact-submit";

// Public (no session) pipeline: the allowed exception to the ctx-first DAL rule.

const PER_IP_PER_FORM_PER_HOUR = 5;
const PER_FORM_PER_HOUR = 200;
const MAX_ANSWERS_JSON = 30_000;
const NOT_AVAILABLE = { ok: false, code: "not_available", error: "This form is not available." } as const;

async function loadActiveForm(slug: string) {
  if (typeof slug !== "string" || slug.length > 60 || !SLUG_RE.test(slug)) return null;
  const [f] = await db
    .select({
      programId: contactForms.programId,
      recipientEmails: contactForms.recipientEmails,
      notifyProgramAdmins: contactForms.notifyProgramAdmins,
      id: contactForms.id,
      slug: contactForms.slug,
      title: contactForms.title,
      intro: contactForms.intro,
      collectPhone: contactForms.collectPhone,
      phoneRequired: contactForms.phoneRequired,
      fields: contactForms.fields,
      submitLabel: contactForms.submitLabel,
      successMessage: contactForms.successMessage,
      privacyNote: contactForms.privacyNote,
    })
    .from(contactForms)
    .where(and(eq(contactForms.slug, slug), eq(contactForms.isActive, true)))
    .limit(1);
  return f ?? null;
}

/** Public-safe view of an active form, or null for unknown / inactive / malformed slugs. */
export async function getPublicContactForm(slug: string): Promise<PublicContactForm | null> {
  const f = await loadActiveForm(slug);
  if (!f) return null;
  const { programId, recipientEmails, notifyProgramAdmins, ...pub } = f;
  void programId; void recipientEmails; void notifyProgramAdmins;
  return pub;
}

/** HMAC-SHA256(BETTER_AUTH_SECRET, ip) as hex. The raw IP is never stored. */
export function hashIp(ip: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(ip).digest("hex");
}

function hostOnly(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    return new URL(v.includes("://") ? v : `http://${v}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/** origin + path of an http(s) URL (no query/hash/credentials), or null. Skips our own host. */
function sanitizeReferrer(raw: unknown, ownHosts: Set<string>): string | null {
  if (typeof raw !== "string" || !raw || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (ownHosts.has(u.host.toLowerCase())) return null;
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[], prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.length ? `${prefix}${String(i.path[0])}` : prefix.replace(/\.$/, "") || "form";
    out[key] ??= i.message;
  }
  return out;
}

function displayValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export async function submitContactForm(
  input: ContactSubmitInput,
  meta: ContactSubmitMeta
): Promise<ContactSubmitResult> {
  // 1. Form must exist and be active (generic response otherwise).
  const form = await loadActiveForm(typeof input.slug === "string" ? input.slug : "");
  if (!form) return NOT_AVAILABLE;

  // 2. Honeypot: pretend success, store nothing.
  if (String(input.website ?? "").trim() !== "") {
    return { ok: true, data: { successMessage: form.successMessage } };
  }

  if (!getTurnstileConfig().enabled) {
    return { ok: false, code: "unavailable", error: "This form is temporarily unavailable." };
  }

  // Body size cap on free-form input.
  let answersRaw: Record<string, unknown> = {};
  if (input.answers && typeof input.answers === "object" && !Array.isArray(input.answers)) {
    answersRaw = input.answers as Record<string, unknown>;
  }
  let answersSize = Infinity;
  try {
    answersSize = JSON.stringify(answersRaw).length;
  } catch {
    // leave Infinity
  }
  const tooBig = (v: unknown, max: number) => typeof v === "string" && v.length > max;
  if (
    answersSize > MAX_ANSWERS_JSON ||
    tooBig(input.name, 2000) ||
    tooBig(input.email, 2000) ||
    tooBig(input.phone, 2000) ||
    tooBig(input.message, 20_000)
  ) {
    return { ok: false, code: "invalid", error: "Your message is too large. Please shorten it and try again." };
  }

  // 3 + 4. Core and custom-field validation (unknown answer keys are stripped).
  const core = buildCoreSchema(form).safeParse({
    name: input.name,
    email: input.email,
    phone: input.phone,
    message: input.message,
  });
  const custom = buildAnswersSchema(form.fields).safeParse(answersRaw);
  if (!core.success || !custom.success) {
    const fieldErrors = {
      ...(core.success ? {} : fieldErrorsFrom(core.error.issues)),
      ...(custom.success ? {} : fieldErrorsFrom(custom.error.issues, "answers.")),
    };
    return { ok: false, code: "invalid", error: "Please fix the highlighted fields.", fieldErrors };
  }
  const { name, email, phone, message } = core.data;
  const answers = custom.data as Record<string, unknown>;

  // 5. Turnstile.
  const token = typeof input.turnstileToken === "string" ? input.turnstileToken : "";
  const human = await verifyTurnstile(token, meta.ip, meta.host);
  if (!human.ok) {
    return {
      ok: false,
      code: "verification",
      error: "Couldn't verify you're human, try again.",
    };
  }

  // 6. Rate limits (per IP-hash per form, and per form), last hour.
  let ipHash: string | null;
  try {
    ipHash = meta.ip ? hashIp(meta.ip) : null;
  } catch (err) {
    console.error("[contact] cannot hash IP", err);
    return { ok: false, code: "unavailable", error: "This form is temporarily unavailable." };
  }
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ n: formCount }] = await db
    .select({ n: count() })
    .from(contactSubmissions)
    .where(and(eq(contactSubmissions.formId, form.id), gt(contactSubmissions.createdAt, since)));
  let ipCount = 0;
  if (ipHash) {
    const [r] = await db
      .select({ n: count() })
      .from(contactSubmissions)
      .where(
        and(
          eq(contactSubmissions.formId, form.id),
          eq(contactSubmissions.ipHash, ipHash),
          gt(contactSubmissions.createdAt, since)
        )
      );
    ipCount = r.n;
  }
  if (ipCount >= PER_IP_PER_FORM_PER_HOUR || formCount >= PER_FORM_PER_HOUR) {
    return {
      ok: false,
      code: "rate_limited",
      error: "We've received a lot of messages from your connection. Please try again in a little while.",
    };
  }

  // 7. Insert.
  const own = new Set(
    [hostOnly(process.env.BETTER_AUTH_URL), hostOnly(meta.host)].filter((h): h is string => !!h)
  );
  const embedReferrer = sanitizeReferrer(input.referrer, own) ?? sanitizeReferrer(meta.referer, own);
  const [row] = await db
    .insert(contactSubmissions)
    .values({
      formId: form.id,
      programId: form.programId,
      name,
      email,
      phone,
      message,
      answers,
      ipHash,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
      embedReferrer,
    })
    .returning({ id: contactSubmissions.id });

  // 8. Best-effort notification; never fails the submission.
  try {
    await notify({ form, formRow: form, submissionId: row.id, name, email, phone, message, answers });
  } catch (err) {
    console.error("[contact] notification email failed", err);
  }

  return { ok: true, data: { successMessage: form.successMessage } };
}

async function notify(a: {
  form: PublicContactForm;
  formRow: { programId: string | null; recipientEmails: string[]; notifyProgramAdmins: boolean };
  submissionId: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  answers: Record<string, unknown>;
}) {
  const { form, formRow } = a;
  const recipients = new Map<string, string>(); // lowercase -> address
  for (const e of formRow.recipientEmails ?? []) {
    const t = typeof e === "string" ? e.trim() : "";
    if (t) recipients.set(t.toLowerCase(), t);
  }
  let programName: string | null = null;
  let programSlug: string | null = null;
  if (formRow.programId) {
    const [p] = await db
      .select({ name: programs.name, slug: programs.slug })
      .from(programs)
      .where(eq(programs.id, formRow.programId))
      .limit(1);
    programName = p?.name ?? null;
    programSlug = p?.slug ?? null;
    if (formRow.notifyProgramAdmins) {
      const admins = await db
        .select({ email: users.email })
        .from(programRoles)
        .innerJoin(users, eq(users.id, programRoles.userId))
        .where(
          and(
            eq(programRoles.programId, formRow.programId),
            eq(programRoles.role, "program_admin"),
            isNull(users.deletedAt),
            eq(users.emailBounced, false)
          )
        );
      for (const u of admins) recipients.set(u.email.toLowerCase(), u.email);
    }
  }
  // Skip addresses of users whose email is flagged as bouncing.
  if (recipients.size) {
    const bounced = await db
      .select({ email: users.email })
      .from(users)
      .where(and(inArray(users.email, [...recipients.values()]), eq(users.emailBounced, true)));
    for (const b of bounced) recipients.delete(b.email.toLowerCase());
  }
  if (recipients.size === 0) return;

  const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
  const inboxUrl = `${base}${programSlug ? `/programs/${programSlug}/contact` : "/admin/contact"}`;
  await sendContactSubmissionEmail({
    to: [...recipients.values()],
    replyTo: a.email,
    formTitle: form.title,
    programName,
    name: a.name,
    email: a.email,
    phone: a.phone,
    message: a.message,
    answers: form.fields
      .filter((f) => a.answers[f.key] !== undefined && a.answers[f.key] !== "")
      .map((f) => ({ label: f.label, value: displayValue(a.answers[f.key]) })),
    inboxUrl,
  });
  await db
    .update(contactSubmissions)
    .set({ notificationSentAt: new Date() })
    .where(eq(contactSubmissions.id, a.submissionId));
}
