import { pgTable, text, timestamp, integer, uuid, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const credentialStatusEnum = pgEnum("credential_status", [
  "pending_review",
  "verified",
  "expired",
  "rejected",
]);

export const credentialDefinitions = pgTable("credential_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(), // e.g., "first_advantage_bg", "safesport", "concussion"
  name: text("name").notNull(),
  description: text("description"),
  defaultValidityMonths: integer("default_validity_months").notNull().default(24),
});

export const userCredentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => credentialDefinitions.id),
    issuerPartner: text("issuer_partner").notNull(), // e.g., "Cal Ripken / First Advantage", "USA Wrestling"
    referenceNumber: text("reference_number"),
    status: credentialStatusEnum("status").notNull().default("pending_review"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    proofObjectKey: text("proof_object_key"), // Railway S3 bucket object key
    reviewerNotes: text("reviewer_notes"),
    // "Reviewed by / at": set for BOTH approve and reject decisions (name kept for compatibility).
    verifiedByUserId: text("verified_by_user_id").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // Cron dedup stamps for expiration warning emails (see /api/cron/compliance).
    expiryWarning30SentAt: timestamp("expiry_warning_30_sent_at", { withTimezone: true }),
    expiryWarning7SentAt: timestamp("expiry_warning_7_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("user_credentials_user_idx").on(t.userId),
    index("user_credentials_status_idx").on(t.status),
    index("user_credentials_expires_idx").on(t.expiresAt),
  ]
);
