import { pgTable, text, timestamp, integer, boolean, jsonb, uuid, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const programRoleEnum = pgEnum("program_role", [
  "program_admin",
  "head_coach",
  "assistant_coach",
  "team_manager",
  "volunteer",
]);

export interface CustomFormField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox" | "number";
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export const programs = pgTable("programs", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sport: text("sport").notNull(),
  description: text("description"),
  isIndependentPartner: boolean("is_independent_partner").notNull().default(false),
  stripeAccountId: text("stripe_account_id"), // Null = routes to primary GBYS Stripe account
  stripeOnboardingComplete: boolean("stripe_onboarding_complete").notNull().default(false),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  requiredCredentialIds: jsonb("required_credential_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const seasons = pgTable("seasons", {
  id: uuid("id").defaultRandom().primaryKey(),
  programId: uuid("program_id")
    .notNull()
    .references(() => programs.id),
  name: text("name").notNull(),
  registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
  registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),
  baseFeeCents: integer("base_fee_cents").notNull().default(0),
  waiverVersion: text("waiver_version").notNull().default("v1.0"),
  waiverText: text("waiver_text").notNull().default(""),
  customFormSchema: jsonb("custom_form_schema")
    .$type<CustomFormField[]>()
    .notNull()
    .default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programRoles = pgTable(
  "program_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    seasonId: uuid("season_id").references(() => seasons.id, { onDelete: "set null" }),
    role: programRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("program_roles_user_idx").on(t.userId), index("program_roles_program_idx").on(t.programId)]
);
