import { pgTable, text, timestamp, boolean, jsonb, uuid, uniqueIndex, index, date } from "drizzle-orm/pg-core";
import { users } from "./auth";

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

export const athletes = pgTable("athletes", {
  id: uuid("id").defaultRandom().primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  // Date-only (YYYY-MM-DD string) to avoid timezone shifts (invariant 9).
  dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
  gender: text("gender"),
  gradeLevel: text("grade_level"),
  medicalNotes: text("medical_notes"), // Allergies, asthma inhaler, epi-pen, etc.
  // Athlete photo (private S3 key, served only via the access-checked /media/athlete/[id] route).
  photoObjectKey: text("photo_object_key"),
  photoUpdatedAt: timestamp("photo_updated_at", { withTimezone: true }),
  emergencyContacts: jsonb("emergency_contacts")
    .$type<EmergencyContact[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const householdGuardians = pgTable(
  "household_guardians",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => athletes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(), // e.g., Parent, Legal Guardian, Grandparent
    canRegister: boolean("can_register").notNull().default(true),
    canSignWaivers: boolean("can_sign_waivers").notNull().default(true),
    receivesComms: boolean("receives_comms").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("athlete_guardian_unique_idx").on(t.athleteId, t.userId)]
);

/**
 * Pending/accepted/revoked invitations for co-guardians. The raw token is never
 * stored: only the sha256 hash of a base64url token (32 random bytes).
 */
export const householdInvites = pgTable(
  "household_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(), // always lowercased
    relationship: text("relationship").notNull(),
    athleteIds: jsonb("athlete_ids").$type<string[]>().notNull(),
    canRegister: boolean("can_register").notNull().default(true),
    canSignWaivers: boolean("can_sign_waivers").notNull().default(true),
    receivesComms: boolean("receives_comms").notNull().default(true),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("household_invites_email_idx").on(t.email)]
);
