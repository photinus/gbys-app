import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uuid,
  pgEnum,
  index,
  date,
  check,
} from "drizzle-orm/pg-core";
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

/**
 * Immutable waiver library (invariant 5). Rows are never updated or deleted:
 * "editing" a waiver inserts a new version. `bodyHash` = sha256 hex of `body`
 * (see src/lib/waiver.ts). Seasons point at one version; signatures record it.
 */
export const waiverVersions = pgTable(
  "waiver_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programId: uuid("program_id").references(() => programs.id), // Null = GBYS org-wide waiver
    title: text("title").notNull(),
    version: text("version").notNull(), // e.g. "v2.4"
    body: text("body").notNull(),
    bodyHash: text("body_hash").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("waiver_versions_program_idx").on(t.programId)]
);

export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    name: text("name").notNull(),
    description: text("description"),
    startsOn: date("starts_on", { mode: "string" }), // display only (LA calendar dates)
    endsOn: date("ends_on", { mode: "string" }),
    registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
    registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),
    // Eligibility by date of birth, inclusive (e.g. Cal Ripken league-age bands). Null = no bound.
    eligibleBirthDateFrom: date("eligible_birth_date_from", { mode: "string" }),
    eligibleBirthDateTo: date("eligible_birth_date_to", { mode: "string" }),
    baseFeeCents: integer("base_fee_cents").notNull().default(0),
    waiverVersionId: uuid("waiver_version_id").references(() => waiverVersions.id),
    customFormSchema: jsonb("custom_form_schema")
      .$type<CustomFormField[]>()
      .notNull()
      .default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("seasons_program_idx").on(t.programId),
    check("seasons_fee_chk", sql`${t.baseFeeCents} >= 0`),
  ]
);

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
