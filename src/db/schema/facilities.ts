import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, jsonb, uuid, index, integer, pgEnum, check } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { programs } from "./programs";

export const resourceKindEnum = pgEnum("resource_kind", ["complex", "field", "gym", "court", "cage", "mat", "room", "other"]);

/**
 * Facility tree (invariant 8): e.g. Riley Creek Complex -> Field A, Field B,
 * Batting Cages. Booking a node blocks its ancestors and descendants.
 */
export const resources = pgTable("resources", {
  id: uuid("id").defaultRandom().primaryKey(),
  parentResourceId: uuid("parent_resource_id"), // Self-ref: High School Gym -> Mat 1, Mat 2
  name: text("name").notNull(),
  kind: resourceKindEnum("kind").notNull().default("other"),
  locationAddress: text("location_address"),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const bookingStatusEnum = pgEnum("booking_status", ["requested", "approved", "declined", "cancelled"]);

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
    createdByUserId: text("created_by_user_id") // requester
      .notNull()
      .references(() => users.id),
    // Only APPROVED bookings occupy a facility. Requests may overlap each other;
    // approval re-checks conflicts under an advisory lock on the facility tree root.
    status: bookingStatusEnum("status").notNull().default("approved"),
    seriesId: uuid("series_id"), // recurring practice series (shared with team_events)
    notes: text("notes"),
    decidedByUserId: text("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByUserId: text("cancelled_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("resource_bookings_resource_idx").on(t.resourceId),
    index("resource_bookings_window_idx").on(t.startsAt, t.endsAt),
    index("resource_bookings_status_idx").on(t.status),
    check("resource_bookings_window_chk", sql`${t.endsAt} > ${t.startsAt}`),
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
