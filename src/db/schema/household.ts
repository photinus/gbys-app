import { pgTable, text, timestamp, boolean, jsonb, uuid, uniqueIndex } from "drizzle-orm/pg-core";
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
  dateOfBirth: timestamp("date_of_birth", { withTimezone: true }).notNull(),
  gender: text("gender"),
  gradeLevel: text("grade_level"),
  medicalNotes: text("medical_notes"), // Allergies, asthma inhaler, epi-pen, etc.
  emergencyContacts: jsonb("emergency_contacts")
    .$type<EmergencyContact[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
