import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  pgEnum,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { programs } from "./programs";

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
