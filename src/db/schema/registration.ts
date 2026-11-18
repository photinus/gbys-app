import { pgTable, text, timestamp, integer, jsonb, uuid, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { athletes } from "./household";
import { seasons } from "./programs";

export const paymentStatusEnum = pgEnum("payment_status", [
  "unpaid",
  "pending",
  "paid",
  "waived_scholarship",
  "refunded",
]);

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
    feeCents: integer("fee_cents").notNull(),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("unpaid"),
    paymentMethod: text("payment_method"), // "stripe", "cash", "check", "scholarship"
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    offlineReferenceNote: text("offline_reference_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("registrations_season_idx").on(t.seasonId),
    index("registrations_athlete_idx").on(t.athleteId),
  ]
);

export const signedWaivers = pgTable("signed_waivers", {
  id: uuid("id").defaultRandom().primaryKey(),
  registrationId: uuid("registration_id").references(() => registrations.id),
  athleteId: uuid("athlete_id")
    .notNull()
    .references(() => athletes.id),
  signedByUserId: text("signed_by_user_id")
    .notNull()
    .references(() => users.id),
  waiverVersion: text("waiver_version").notNull(),
  waiverTextHash: text("waiver_text_hash").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), // Stripe event.id or Nuntly message/event ID
  provider: text("provider").notNull(), // "stripe" | "nuntly"
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
