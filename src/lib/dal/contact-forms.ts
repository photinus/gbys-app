import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { contactForms, contactSubmissions, programs } from "@/db/schema";
import type { CustomFormField } from "@/lib/custom-form";
import { writeAudit } from "@/lib/audit";
import {
  CONTACT_FORM_FIELD_NAMES,
  CONTACT_PAGE_SIZE,
  SUBMISSION_STATUSES,
  contactFormInputSchema,
  inboxFiltersSchema,
  parseSubmissionCursor,
  type ContactFormInput,
  type InboxFilters,
  type ParsedContactFormInput,
  type StatusFilter,
  type SubmissionStatus,
} from "@/lib/validation/contact-forms";
import { DalError, isBoard, type SessionContext } from "./context";
import { assertProgramReachable, canManageProgram } from "./permissions";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const forbidden = () => new DalError("FORBIDDEN", "You do not have permission to do that.");

/** Program forms: canManageProgram (program admins + board). Org-wide forms (null): board only. */
export function canManageContactForm(ctx: SessionContext, programId: string | null): boolean {
  return programId === null ? isBoard(ctx) : canManageProgram(ctx, programId);
}

/** Where to look: every form (board only) or one program's forms. */
export type ContactScope = { all: true } | { programId: string };

async function authorizeScope(ctx: SessionContext, scope: ContactScope): Promise<void> {
  if ("all" in scope) {
    if (!isBoard(ctx)) throw forbidden();
    return;
  }
  if (!uuidRe.test(scope.programId)) throw new DalError("NOT_FOUND", "Program not found.");
  if (!canManageProgram(ctx, scope.programId)) throw forbidden();
  await assertProgramReachable(ctx, scope.programId);
}

// ---------------------------------------------------------------------------
// Program lookup for the program-scoped pages
// ---------------------------------------------------------------------------

export interface ContactProgram {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
}

/** Program by slug for /programs/[slug]/contact/**. Requires canManageProgram; hides inactive programs from non-board. */
export async function getProgramForContact(ctx: SessionContext, slug: string): Promise<ContactProgram> {
  const [p] = await db
    .select({ id: programs.id, slug: programs.slug, name: programs.name, isActive: programs.isActive })
    .from(programs)
    .where(and(eq(programs.slug, slug), isNull(programs.deletedAt)))
    .limit(1);
  if (!p || (!p.isActive && !isBoard(ctx))) throw new DalError("NOT_FOUND", "Program not found.");
  if (!canManageProgram(ctx, p.id)) throw forbidden();
  return p;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export interface ContactFormRow {
  id: string;
  programId: string | null;
  programName: string | null;
  programSlug: string | null;
  slug: string;
  title: string;
  isActive: boolean;
  newCount: number;
  totalCount: number;
  createdAt: Date;
}

export interface ContactFormDetail {
  id: string;
  programId: string | null;
  programName: string | null;
  programSlug: string | null;
  slug: string;
  title: string;
  intro: string | null;
  collectPhone: boolean;
  phoneRequired: boolean;
  fields: CustomFormField[];
  recipientEmails: string[];
  notifyProgramAdmins: boolean;
  submitLabel: string;
  successMessage: string;
  privacyNote: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const formColumns = {
  id: contactForms.id,
  programId: contactForms.programId,
  programName: programs.name,
  programSlug: programs.slug,
  slug: contactForms.slug,
  title: contactForms.title,
  intro: contactForms.intro,
  collectPhone: contactForms.collectPhone,
  phoneRequired: contactForms.phoneRequired,
  fields: contactForms.fields,
  recipientEmails: contactForms.recipientEmails,
  notifyProgramAdmins: contactForms.notifyProgramAdmins,
  submitLabel: contactForms.submitLabel,
  successMessage: contactForms.successMessage,
  privacyNote: contactForms.privacyNote,
  isActive: contactForms.isActive,
  createdAt: contactForms.createdAt,
  updatedAt: contactForms.updatedAt,
};

export async function listContactForms(ctx: SessionContext, scope: ContactScope): Promise<ContactFormRow[]> {
  await authorizeScope(ctx, scope);
  const where = "all" in scope ? undefined : eq(contactForms.programId, scope.programId);
  return db
    .select({
      id: contactForms.id,
      programId: contactForms.programId,
      programName: programs.name,
      programSlug: programs.slug,
      slug: contactForms.slug,
      title: contactForms.title,
      isActive: contactForms.isActive,
      newCount: sql<number>`(select count(*) from ${contactSubmissions} s where s.form_id = ${contactForms.id} and s.status = 'new')`.mapWith(Number),
      totalCount: sql<number>`(select count(*) from ${contactSubmissions} s where s.form_id = ${contactForms.id})`.mapWith(Number),
      createdAt: contactForms.createdAt,
    })
    .from(contactForms)
    .leftJoin(programs, eq(programs.id, contactForms.programId))
    .where(where)
    .orderBy(sql`${programs.name} asc nulls first`, asc(contactForms.title));
}

export async function getContactForm(ctx: SessionContext, id: string): Promise<ContactFormDetail> {
  if (!uuidRe.test(id)) throw new DalError("NOT_FOUND", "Form not found.");
  const [f] = await db
    .select(formColumns)
    .from(contactForms)
    .leftJoin(programs, eq(programs.id, contactForms.programId))
    .where(eq(contactForms.id, id))
    .limit(1);
  if (!f) throw new DalError("NOT_FOUND", "Form not found.");
  if (!canManageContactForm(ctx, f.programId)) throw forbidden();
  if (f.programId) await assertProgramReachable(ctx, f.programId);
  return f;
}

function parseFormInput(raw: ContactFormInput, programId: string | null): ParsedContactFormInput {
  const input = contactFormInputSchema.parse(raw);
  if (programId === null) {
    // Org-wide: there are no "program admins" to notify, so it needs an explicit recipient.
    input.notifyProgramAdmins = false;
    if (input.recipientEmails.length === 0) throw new DalError("INVALID", "Add at least one recipient email.");
  } else if (input.recipientEmails.length === 0 && !input.notifyProgramAdmins) {
    throw new DalError("INVALID", "Add a recipient email or notify the program's admins.");
  }
  return input;
}

async function assertSlugFree(slug: string, exceptId?: string): Promise<void> {
  const [clash] = await db
    .select({ id: contactForms.id })
    .from(contactForms)
    .where(exceptId ? and(eq(contactForms.slug, slug), ne(contactForms.id, exceptId)) : eq(contactForms.slug, slug))
    .limit(1);
  if (clash) throw new DalError("INVALID", "That URL name is already used by another form.");
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } } | null);
  return code?.code === "23505" || code?.cause?.code === "23505";
}

export async function createContactForm(ctx: SessionContext, raw: ContactFormInput): Promise<{ id: string }> {
  const programId = raw.programId ? raw.programId : null;
  if (programId !== null && !uuidRe.test(programId)) throw new DalError("NOT_FOUND", "Program not found.");
  if (!canManageContactForm(ctx, programId)) throw forbidden();
  if (programId) {
    const [p] = await db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, programId), isNull(programs.deletedAt)))
      .limit(1);
    if (!p) throw new DalError("NOT_FOUND", "Program not found.");
    await assertProgramReachable(ctx, programId);
  }
  const input = parseFormInput(raw, programId);
  await assertSlugFree(input.slug);

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(contactForms)
        .values({
          programId,
          slug: input.slug,
          title: input.title,
          intro: input.intro,
          collectPhone: input.collectPhone,
          phoneRequired: input.phoneRequired,
          fields: input.fields,
          recipientEmails: input.recipientEmails,
          notifyProgramAdmins: input.notifyProgramAdmins,
          submitLabel: input.submitLabel,
          successMessage: input.successMessage,
          privacyNote: input.privacyNote,
          isActive: input.isActive,
          createdByUserId: ctx.userId,
        })
        .returning({ id: contactForms.id });
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "contact_form.created",
          targetType: "contact_form",
          targetId: row.id,
          metadata: { slug: input.slug, programId, title: input.title, fieldCount: input.fields.length },
        },
        tx
      );
      return { id: row.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DalError("INVALID", "That URL name is already used by another form.");
    throw e;
  }
}

export async function updateContactForm(ctx: SessionContext, id: string, raw: ContactFormInput): Promise<{ id: string }> {
  const existing = await getContactForm(ctx, id); // authorizes (program admin of that program, or board for org-wide)
  // A form never moves between programs (or to/from org-wide).
  if (raw.programId !== undefined && (raw.programId || null) !== existing.programId) {
    throw new DalError("INVALID", "A form can't be moved to another program.");
  }
  const input = parseFormInput(raw, existing.programId);
  if (input.slug !== existing.slug) await assertSlugFree(input.slug, id);

  const next = {
    slug: input.slug,
    title: input.title,
    intro: input.intro,
    collectPhone: input.collectPhone,
    phoneRequired: input.phoneRequired,
    fields: input.fields,
    recipientEmails: input.recipientEmails,
    notifyProgramAdmins: input.notifyProgramAdmins,
    submitLabel: input.submitLabel,
    successMessage: input.successMessage,
    privacyNote: input.privacyNote,
    isActive: input.isActive,
  };
  const before: Record<string, unknown> = existing as unknown as Record<string, unknown>;
  const changed = CONTACT_FORM_FIELD_NAMES.filter(
    (k) => JSON.stringify((next as Record<string, unknown>)[k] ?? null) !== JSON.stringify(before[k] ?? null)
  );
  if (changed.length === 0) return { id };

  try {
    await db.transaction(async (tx) => {
      await tx.update(contactForms).set(next).where(eq(contactForms.id, id));
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "contact_form.updated",
          targetType: "contact_form",
          targetId: id,
          metadata: { changed, slug: input.slug },
        },
        tx
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DalError("INVALID", "That URL name is already used by another form.");
    throw e;
  }
  return { id };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export interface SubmissionRow {
  id: string;
  formId: string;
  formTitle: string;
  name: string;
  email: string;
  preview: string;
  status: SubmissionStatus;
  /** ISO instant (ms precision, for display). */
  createdAt: string;
}

export interface SubmissionPage {
  rows: SubmissionRow[];
  /** Opaque cursor for the next (older) page, or null on the last page. */
  nextCursor: string | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function statusCondition(status: StatusFilter | undefined): SQL | undefined {
  const s = status ?? "open";
  if (s === "all") return undefined;
  if (s === "open") return inArray(contactSubmissions.status, ["new", "read"]);
  return eq(contactSubmissions.status, s);
}

/**
 * Keyset-paginated inbox (created_at desc, id desc; 50 per page). `scope` {all} is board-only;
 * {programId} requires canManageProgram and only returns that program's submissions.
 */
export async function listSubmissions(
  ctx: SessionContext,
  input: { scope: ContactScope; formId?: string; status?: StatusFilter; q?: string; cursor?: string | null }
): Promise<SubmissionPage> {
  await authorizeScope(ctx, input.scope);
  const f: InboxFilters = inboxFiltersSchema.parse({ formId: input.formId, status: input.status, q: input.q });

  const conds: (SQL | undefined)[] = [];
  if (!("all" in input.scope)) conds.push(eq(contactSubmissions.programId, input.scope.programId));
  if (f.formId) conds.push(eq(contactSubmissions.formId, f.formId));
  conds.push(statusCondition(f.status));
  if (f.q) {
    const pat = `%${escapeLike(f.q)}%`;
    conds.push(or(ilike(contactSubmissions.name, pat), ilike(contactSubmissions.email, pat)));
  }
  if (input.cursor) {
    const c = parseSubmissionCursor(input.cursor);
    conds.push(sql`(${contactSubmissions.createdAt}, ${contactSubmissions.id}) < (${c.ts + "Z"}::timestamptz, ${c.id}::uuid)`);
  }

  const rows = await db
    .select({
      id: contactSubmissions.id,
      formId: contactSubmissions.formId,
      formTitle: contactForms.title,
      name: contactSubmissions.name,
      email: contactSubmissions.email,
      message: contactSubmissions.message,
      status: contactSubmissions.status,
      createdAt: contactSubmissions.createdAt,
      cursorTs: sql<string>`to_char(${contactSubmissions.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
    })
    .from(contactSubmissions)
    .innerJoin(contactForms, eq(contactForms.id, contactSubmissions.formId))
    .where(and(...conds))
    .orderBy(desc(contactSubmissions.createdAt), desc(contactSubmissions.id))
    .limit(CONTACT_PAGE_SIZE + 1);

  const hasMore = rows.length > CONTACT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, CONTACT_PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => ({
      id: r.id,
      formId: r.formId,
      formTitle: r.formTitle,
      name: r.name,
      email: r.email,
      preview: r.message.replace(/\s+/g, " ").slice(0, 160),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor: hasMore && last ? `${last.cursorTs}|${last.id}` : null,
  };
}

export interface SubmissionDetail {
  id: string;
  formId: string;
  formTitle: string;
  programId: string | null;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  /** Answers to the form's extra questions, labelled (labels from the form as it is now). */
  answers: { key: string; label: string; value: string }[];
  status: SubmissionStatus;
  embedReferrer: string | null;
  createdAt: string;
  readAt: string | null;
}

function answerText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

async function loadSubmissionRow(ctx: SessionContext, id: string) {
  if (!uuidRe.test(id)) throw new DalError("NOT_FOUND", "Message not found.");
  const [s] = await db
    .select({
      id: contactSubmissions.id,
      formId: contactSubmissions.formId,
      programId: contactSubmissions.programId,
      formTitle: contactForms.title,
      formFields: contactForms.fields,
      name: contactSubmissions.name,
      email: contactSubmissions.email,
      phone: contactSubmissions.phone,
      message: contactSubmissions.message,
      answers: contactSubmissions.answers,
      status: contactSubmissions.status,
      embedReferrer: contactSubmissions.embedReferrer,
      createdAt: contactSubmissions.createdAt,
      readAt: contactSubmissions.readAt,
    })
    .from(contactSubmissions)
    .innerJoin(contactForms, eq(contactForms.id, contactSubmissions.formId))
    .where(eq(contactSubmissions.id, id))
    .limit(1);
  if (!s) throw new DalError("NOT_FOUND", "Message not found.");
  if (!canManageContactForm(ctx, s.programId)) throw forbidden();
  if (s.programId) await assertProgramReachable(ctx, s.programId);
  return s;
}

/** Opens a message. The first open flips `new` to `read` (readAt / readBy). Never exposes ipHash/userAgent. */
export async function getSubmission(ctx: SessionContext, id: string): Promise<SubmissionDetail> {
  const s = await loadSubmissionRow(ctx, id);
  let status = s.status;
  let readAt = s.readAt;
  if (status === "new") {
    const now = new Date();
    const upd = await db
      .update(contactSubmissions)
      .set({ status: "read", readAt: now, readByUserId: ctx.userId })
      .where(and(eq(contactSubmissions.id, id), eq(contactSubmissions.status, "new")))
      .returning({ id: contactSubmissions.id });
    if (upd.length) {
      status = "read";
      readAt = now;
    }
  }
  const labelled = s.formFields.map((f) => ({ key: f.key, label: f.label, value: answerText(s.answers?.[f.key]) }));
  const known = new Set(s.formFields.map((f) => f.key));
  const extra = Object.entries(s.answers ?? {})
    .filter(([k]) => !known.has(k))
    .map(([k, v]) => ({ key: k, label: k, value: answerText(v) }));
  return {
    id: s.id,
    formId: s.formId,
    formTitle: s.formTitle,
    programId: s.programId,
    name: s.name,
    email: s.email,
    phone: s.phone,
    message: s.message,
    answers: [...labelled, ...extra],
    status,
    embedReferrer: s.embedReferrer,
    createdAt: s.createdAt.toISOString(),
    readAt: readAt ? readAt.toISOString() : null,
  };
}

export async function setSubmissionStatus(ctx: SessionContext, id: string, status: SubmissionStatus): Promise<{ status: SubmissionStatus }> {
  if (!(SUBMISSION_STATUSES as readonly string[]).includes(status)) throw new DalError("INVALID", "Unknown status.");
  const s = await loadSubmissionRow(ctx, id);
  if (s.status === status) return { status };
  await db.transaction(async (tx) => {
    await tx
      .update(contactSubmissions)
      .set(
        status === "new"
          ? { status, readAt: null, readByUserId: null }
          : s.readAt
            ? { status }
            : { status, readAt: new Date(), readByUserId: ctx.userId }
      )
      .where(eq(contactSubmissions.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "contact_submission.status_changed",
        targetType: "contact_submission",
        targetId: id,
        metadata: { formId: s.formId, from: s.status, to: status },
      },
      tx
    );
  });
  return { status };
}

/** Board only. Hard delete (PII removal requests). The audit row carries ids and a timestamp, never contents. */
export async function deleteSubmission(ctx: SessionContext, id: string): Promise<void> {
  if (!isBoard(ctx)) throw forbidden();
  if (!uuidRe.test(id)) throw new DalError("NOT_FOUND", "Message not found.");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(contactSubmissions)
      .where(eq(contactSubmissions.id, id))
      .returning({ formId: contactSubmissions.formId });
    if (!row) throw new DalError("NOT_FOUND", "Message not found.");
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "contact_submission.deleted",
        targetType: "contact_submission",
        targetId: id,
        metadata: { formId: row.formId, deletedAt: new Date().toISOString() },
      },
      tx
    );
  });
}

export async function countNewSubmissions(ctx: SessionContext, scope: ContactScope): Promise<number> {
  await authorizeScope(ctx, scope);
  const [r] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(contactSubmissions)
    .where(
      "all" in scope
        ? eq(contactSubmissions.status, "new")
        : and(eq(contactSubmissions.programId, scope.programId), eq(contactSubmissions.status, "new"))
    );
  return r?.n ?? 0;
}
