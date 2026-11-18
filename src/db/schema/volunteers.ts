import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  uuid,
  pgEnum,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { programs, programRoleEnum, seasons } from "./programs";

export const volunteerCategoryEnum = pgEnum("volunteer_category", [
  "coaching",
  "event_ops",
  "admin_board",
  "facility_maintenance",
  "concessions",
  "other",
]);

export const verificationMethodEnum = pgEnum("verification_method", [
  "self_reported",
  "shift_checkin",
  "admin_approved",
]);

export const volunteerRolePeriodEnum = pgEnum("volunteer_role_period", ["per_season", "per_year"]);

export const volunteerRoleAssignmentStatusEnum = pgEnum("volunteer_role_assignment_status", [
  "pending",
  "active",
  "declined",
  "withdrawn",
  "ended",
]);

/**
 * Catalog of volunteer positions (e.g. "Program Coordinator", "Head Baseball Coach").
 * programId null = org-wide role (board-managed). Expected hours are per term:
 * per_season (program roles only; term = a season) or per_year (LA calendar year).
 *
 * Safety invariant (DB-enforced): a role that grants a permission role (roster /
 * emergency-sheet access) must be program-scoped AND require approval, so nobody
 * can self-grant access to athlete medical data.
 */
export const volunteerRoles = pgTable(
  "volunteer_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programId: uuid("program_id").references(() => programs.id), // Null = org-wide
    name: text("name").notNull(),
    description: text("description"),
    category: volunteerCategoryEnum("category").notNull(), // default category for hours logged under it
    period: volunteerRolePeriodEnum("period").notNull(),
    expectedMinutes: integer("expected_minutes").notNull(), // per term
    slots: integer("slots"), // live (pending+active) assignments allowed per term; null = unlimited
    requiresApproval: boolean("requires_approval").notNull().default(true),
    grantsProgramRole: programRoleEnum("grants_program_role"), // null = grants no permissions
    requiredCredentialIds: jsonb("required_credential_ids").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("volunteer_roles_program_idx").on(t.programId),
    check("volunteer_roles_expected_chk", sql`${t.expectedMinutes} >= 0 and ${t.expectedMinutes} <= 200000`),
    check("volunteer_roles_slots_chk", sql`${t.slots} is null or ${t.slots} >= 1`),
    check(
      "volunteer_roles_season_needs_program_chk",
      sql`${t.period} <> 'per_season' or ${t.programId} is not null`
    ),
    check(
      "volunteer_roles_grant_safety_chk",
      sql`${t.grantsProgramRole} is null or (${t.requiresApproval} and ${t.programId} is not null)`
    ),
  ]
);

/**
 * A person's sign-up for a role for one term. termKey = "season:<uuid>" or
 * "year:<yyyy>" (see src/lib/dal/volunteer-role-shared.ts). One live
 * (pending/active) assignment per (role, user, term). Rows are never deleted;
 * status transitions record who/when/why. expectedMinutes is snapshotted when the
 * assignment becomes active so later catalog edits don't rewrite grant history.
 * programRoleId links the permission row created on approval (revoked on end).
 */
export const volunteerRoleAssignments = pgTable(
  "volunteer_role_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => volunteerRoles.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    seasonId: uuid("season_id").references(() => seasons.id),
    year: integer("year"),
    termKey: text("term_key").notNull(),
    status: volunteerRoleAssignmentStatusEnum("status").notNull().default("pending"),
    expectedMinutes: integer("expected_minutes"), // snapshot; set when active
    signedUpAt: timestamp("signed_up_at", { withTimezone: true }).notNull().defaultNow(),
    signupNote: text("signup_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: text("decided_by_user_id").references(() => users.id),
    decisionNote: text("decision_note"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedByUserId: text("ended_by_user_id").references(() => users.id),
    endReason: text("end_reason"),
    programRoleId: uuid("program_role_id"), // program_roles.id created on approval (no FK: that row is deleted on end)
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("vra_role_idx").on(t.roleId),
    index("vra_user_idx").on(t.userId),
    uniqueIndex("vra_live_unique_idx")
      .on(t.roleId, t.userId, t.termKey)
      .where(sql`${t.status} in ('pending', 'active')`),
    check(
      "vra_term_chk",
      sql`(${t.seasonId} is not null and ${t.year} is null) or (${t.seasonId} is null and ${t.year} is not null)`
    ),
  ]
);

/**
 * A volunteer opportunity with `spotsTotal` slots. Who fills the slots lives in
 * `volunteer_shift_signups`. Shifts are never hard-deleted: cancel via `cancelledAt`.
 */
export const volunteerShifts = pgTable(
  "volunteer_shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    programId: uuid("program_id").references(() => programs.id), // Null = Org-wide event
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    category: volunteerCategoryEnum("category").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    spotsTotal: integer("spots_total").notNull().default(1),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("volunteer_shifts_starts_idx").on(t.startsAt),
    index("volunteer_shifts_program_idx").on(t.programId),
    check("volunteer_shifts_window_chk", sql`${t.endsAt} > ${t.startsAt}`),
    check("volunteer_shifts_spots_chk", sql`${t.spotsTotal} >= 1`),
  ]
);

/**
 * One row per (shift, volunteer). Cancelling sets `cancelledAt`; signing up again
 * clears it (the unique index keeps one row per pair). Check-in stamps
 * `checkedInAt` and links the auto-created ledger entry via `volunteerLogId`.
 */
export const volunteerShiftSignups = pgTable(
  "volunteer_shift_signups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => volunteerShifts.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    signedUpAt: timestamp("signed_up_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInByUserId: text("checked_in_by_user_id").references(() => users.id),
    volunteerLogId: uuid("volunteer_log_id").references(() => volunteerLogs.id),
  },
  (t) => [
    uniqueIndex("shift_signup_unique_idx").on(t.shiftId, t.userId),
    index("shift_signups_user_idx").on(t.userId),
  ]
);

/**
 * Grant-auditable time ledger (invariant 7). Rows are never edited for hours or
 * dates and never hard-deleted. Allowed mutations:
 *  - approval: self_reported -> admin_approved, setting approvedByUserId/approvedAt
 *  - soft delete / rejection: deletedAt + deletedByUserId + deletionReason
 * Corrections = soft-delete + new entry.
 */
export const volunteerLogs = pgTable(
  "volunteer_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    programId: uuid("program_id").references(() => programs.id), // Null = Org/Board general hours
    shiftId: uuid("shift_id").references(() => volunteerShifts.id),
    // Hours logged against a volunteer role assignment (grant: expected vs actual).
    volunteerRoleAssignmentId: uuid("volunteer_role_assignment_id").references(() => volunteerRoleAssignments.id),
    category: volunteerCategoryEnum("category").notNull(),
    activityDate: timestamp("activity_date", { withTimezone: true }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    description: text("description"),
    verificationMethod: verificationMethodEnum("verification_method")
      .notNull()
      .default("self_reported"),
    createdByUserId: text("created_by_user_id").references(() => users.id), // who entered it (self or admin on behalf)
    approvedByUserId: text("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    inKindRateCents: integer("in_kind_rate_cents"), // Independent Sector hourly valuation snapshot
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByUserId: text("deleted_by_user_id").references(() => users.id),
    deletionReason: text("deletion_reason"),
  },
  (t) => [
    index("volunteer_logs_user_idx").on(t.userId),
    index("volunteer_logs_date_idx").on(t.activityDate),
    index("volunteer_logs_program_idx").on(t.programId),
    index("volunteer_logs_role_assignment_idx").on(t.volunteerRoleAssignmentId),
    // At most one live ledger entry per volunteer per shift (double check-in guard).
    uniqueIndex("volunteer_logs_shift_user_live_idx")
      .on(t.shiftId, t.userId)
      .where(sql`${t.shiftId} is not null and ${t.deletedAt} is null`),
    check(
      "volunteer_logs_duration_chk",
      sql`${t.durationMinutes} > 0 and ${t.durationMinutes} <= 1440`
    ),
  ]
);
