import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  pgEnum,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { athletes } from "./household";
import { seasons, waiverVersions } from "./programs";

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "pending",
  "paid",
  "waived_scholarship",
  "refunded",
]);

export const paymentMethodEnum = pgEnum("payment_method", ["stripe", "cash", "check", "scholarship"]);

/**
 * One live registration per (season, athlete). Withdrawal / cancellation is a
 * soft delete (deletedAt + deletedByUserId + cancellationReason).
 * Payments (invariant 6): online Stripe (Sprint 3b) or offline cash / check /
 * scholarship recorded by program staff (paymentRecordedByUserId).
 */
export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id),
    registeredByUserId: text("registered_by_user_id")
      .notNull()
      .references(() => users.id),
    customAnswers: jsonb("custom_answers")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    feeCents: integer("fee_cents").notNull(), // snapshot of season.baseFeeCents at registration
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
    paymentMethod: paymentMethodEnum("payment_method"),
    amountPaidCents: integer("amount_paid_cents"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentRecordedByUserId: text("payment_recorded_by_user_id").references(() => users.id),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    // Account the payment was charged on: null = GBYS platform account, else the league's acct_….
    stripeAccountId: text("stripe_account_id"),
    platformFeeChargedCents: integer("platform_fee_charged_cents"), // application fee snapshot
    refundedCents: integer("refunded_cents").notNull().default(0),
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    offlineReferenceNote: text("offline_reference_note"), // e.g. "Check #1042"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    cancellationReason: text("cancellation_reason"),
  },
  (t) => [
    index("registrations_season_idx").on(t.seasonId),
    index("registrations_athlete_idx").on(t.athleteId),
    uniqueIndex("registrations_season_athlete_live_idx")
      .on(t.seasonId, t.athleteId)
      .where(sql`${t.deletedAt} is null`),
    check("registrations_fee_chk", sql`${t.feeCents} >= 0`),
  ]
);

/**
 * Immutable e-signature record (invariant 5). Never updated or deleted.
 * `waiverVersion` and `waiverTextHash` duplicate the waiver_versions row on
 * purpose so the record stands alone in an audit.
 */
export const signedWaivers = pgTable(
  "signed_waivers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    registrationId: uuid("registration_id").references(() => registrations.id),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id),
    signedByUserId: text("signed_by_user_id")
      .notNull()
      .references(() => users.id),
    waiverVersionId: uuid("waiver_version_id")
      .notNull()
      .references(() => waiverVersions.id),
    waiverVersion: text("waiver_version").notNull(),
    waiverTextHash: text("waiver_text_hash").notNull(),
    signatureName: text("signature_name").notNull(), // typed full legal name
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("signed_waivers_registration_idx").on(t.registrationId),
    index("signed_waivers_athlete_idx").on(t.athleteId),
  ]
);

export const paymentEventKindEnum = pgEnum("payment_event_kind", [
  "charge",
  "refund",
  "dispute_opened",
  "dispute_closed",
  "offline_payment",
  "offline_void",
]);

/**
 * Append-only money ledger (DB trigger forbids UPDATE/DELETE). One row per
 * charge, refund, dispute and offline payment/void. Stripe rows are keyed by
 * the Stripe object id (unique) so webhook redelivery can never double-count.
 * amountCents is always positive; the kind gives the direction.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id),
    programId: uuid("program_id"),
    kind: paymentEventKindEnum("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    applicationFeeCents: integer("application_fee_cents"),
    stripeObjectId: text("stripe_object_id").unique(), // pi_/re_/dp_ ids; null for offline rows
    stripeAccountId: text("stripe_account_id"), // null = platform account
    method: paymentMethodEnum("method"),
    note: text("note"),
    recordedByUserId: text("recorded_by_user_id").references(() => users.id), // null = Stripe webhook
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payment_events_registration_idx").on(t.registrationId),
    index("payment_events_program_idx").on(t.programId, t.occurredAt),
    check("payment_events_amount_chk", sql`${t.amountCents} >= 0`),
  ]
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), // Stripe event.id or Nuntly message/event ID
  provider: text("provider").notNull(), // "stripe" | "nuntly"
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
