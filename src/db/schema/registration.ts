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

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), // Stripe event.id or Nuntly message/event ID
  provider: text("provider").notNull(), // "stripe" | "nuntly"
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
