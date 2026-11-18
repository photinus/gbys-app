import { pgTable, text, timestamp, integer, uuid, pgEnum, index } from "drizzle-orm/pg-core";
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

export const volunteerShifts = pgTable("volunteer_shifts", {
  id: uuid("id").defaultRandom().primaryKey(),
  programId: uuid("program_id").references(() => programs.id), // Null = Org-wide event
  title: text("title").notNull(),
  description: text("description"),
  category: volunteerCategoryEnum("category").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  spotsTotal: integer("spots_total").notNull().default(1),
  assignedUserId: text("assigned_user_id").references(() => users.id),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    approvedByUserId: text("approved_by_user_id").references(() => users.id),
    inKindRateCents: integer("in_kind_rate_cents"), // Independent Sector hourly valuation snapshot
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("volunteer_logs_user_idx").on(t.userId),
    index("volunteer_logs_date_idx").on(t.activityDate),
    index("volunteer_logs_program_idx").on(t.programId),
  ]
);
