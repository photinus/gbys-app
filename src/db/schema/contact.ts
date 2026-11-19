import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, jsonb, uuid, pgEnum, index, check } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { programs, type CustomFormField } from "./programs";

/**
 * Public "Contact us" forms. programId null = org-wide form (board-managed);
 * otherwise managed by that program's admins (and the board). Core fields are
 * fixed (name, email, message; phone optional) so replies always work;
 * `fields` holds extra builder fields (seasons' CustomFormField format).
 */
export const contactForms = pgTable(
  "contact_forms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programId: uuid("program_id").references(() => programs.id),
    slug: text("slug").notNull().unique(), // public URL key: /contact/<slug>, /embed/contact/<slug>
    title: text("title").notNull(),
    intro: text("intro"),
    collectPhone: boolean("collect_phone").notNull().default(false),
    phoneRequired: boolean("phone_required").notNull().default(false),
    fields: jsonb("fields").$type<CustomFormField[]>().notNull().default([]),
    recipientEmails: jsonb("recipient_emails").$type<string[]>().notNull().default([]),
    notifyProgramAdmins: boolean("notify_program_admins").notNull().default(true),
    submitLabel: text("submit_label").notNull().default("Send message"),
    successMessage: text("success_message").notNull().default("Thanks! We'll get back to you soon."),
    privacyNote: text("privacy_note"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("contact_forms_program_idx").on(t.programId),
    check("contact_forms_phone_chk", sql`${t.collectPhone} or not ${t.phoneRequired}`),
  ]
);

export const contactSubmissionStatusEnum = pgEnum("contact_submission_status", ["new", "read", "archived", "spam"]);

/**
 * Submissions (PII). IP is stored only as an HMAC (rate limiting), never raw.
 * programId is snapshotted from the form at submit time for inbox scoping.
 */
export const contactSubmissions = pgTable(
  "contact_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    formId: uuid("form_id")
      .notNull()
      .references(() => contactForms.id),
    programId: uuid("program_id").references(() => programs.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    message: text("message").notNull(),
    answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
    status: contactSubmissionStatusEnum("status").notNull().default("new"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    embedReferrer: text("embed_referrer"), // page the embed ran on (origin + path only)
    notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    readByUserId: text("read_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contact_submissions_form_idx").on(t.formId, t.createdAt),
    index("contact_submissions_program_idx").on(t.programId, t.createdAt),
    index("contact_submissions_ip_idx").on(t.ipHash, t.createdAt),
  ]
);
