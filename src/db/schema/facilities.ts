import { pgTable, text, timestamp, boolean, jsonb, uuid, index } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { programs } from "./programs";

export const resources = pgTable("resources", {
  id: uuid("id").defaultRandom().primaryKey(),
  parentResourceId: uuid("parent_resource_id"), // Self-ref: High School Gym -> Mat 1, Mat 2
  name: text("name").notNull(),
  locationAddress: text("location_address"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
});

export const resourceBookings = pgTable(
  "resource_bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    programId: uuid("program_id").references(() => programs.id),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("resource_bookings_resource_idx").on(t.resourceId),
    index("resource_bookings_window_idx").on(t.startsAt, t.endsAt),
  ]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id),
    action: text("action").notNull(), // e.g., "credential.verified", "medical.viewed", "grant.exported"
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    index("audit_logs_actor_idx").on(t.actorUserId),
  ]
);
