import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, uuid, pgEnum, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { programs, seasons } from "./programs";
import { registrations } from "./registration";
import { resourceBookings, resources } from "./facilities";

/**
 * Teams within a season. Coach access is TEAM-scoped (user decision): team staff
 * see only their team's roster / emergency sheet / schedule; program admins and
 * the board see every team. programId is denormalised from the season for scoping.
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    name: text("name").notNull(),
    division: text("division"), // e.g. "Minors (9-10U)"
    color: text("color"), // #RRGGBB for calendars
    // Secret for the public read-only ICS feed (/calendar/team/<token>); rotate to revoke.
    calendarToken: text("calendar_token").notNull().unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("teams_season_name_idx").on(t.seasonId, sql`lower(${t.name})`),
    index("teams_program_idx").on(t.programId),
    check("teams_color_chk", sql`${t.color} is null or ${t.color} ~ '^#[0-9A-Fa-f]{6}$'`),
  ]
);

/** Player on a team = a live registration. One live team per registration; history kept. */
export const teamPlayers = pgTable(
  "team_players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id),
    jerseyNumber: text("jersey_number"),
    addedByUserId: text("added_by_user_id").references(() => users.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: text("removed_by_user_id").references(() => users.id),
  },
  (t) => [
    uniqueIndex("team_players_live_reg_idx").on(t.registrationId).where(sql`${t.removedAt} is null`),
    index("team_players_team_idx").on(t.teamId),
  ]
);

export const teamStaffRoleEnum = pgEnum("team_staff_role", ["head_coach", "assistant_coach", "team_manager"]);

/** Coaches / managers of a team. Grants team-scoped access (see SessionContext.teamStaff). */
export const teamStaff = pgTable(
  "team_staff",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: teamStaffRoleEnum("role").notNull(),
    addedByUserId: text("added_by_user_id").references(() => users.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByUserId: text("removed_by_user_id").references(() => users.id),
  },
  (t) => [
    uniqueIndex("team_staff_live_idx").on(t.teamId, t.userId).where(sql`${t.removedAt} is null`),
    index("team_staff_user_idx").on(t.userId),
  ]
);

export const teamEventKindEnum = pgEnum("team_event_kind", ["practice", "game", "event"]);
export const teamEventSiteEnum = pgEnum("team_event_site", ["home", "away", "neutral"]);
export const teamEventStatusEnum = pgEnum("team_event_status", ["scheduled", "cancelled"]);

/**
 * A team's schedule entry. On one of OUR facilities it links a resource_booking
 * (whose status drives "requested / confirmed / declined"); away / off-site
 * events have no booking and use locationText.
 */
export const teamEvents = pgTable(
  "team_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    kind: teamEventKindEnum("kind").notNull(),
    title: text("title"), // optional override; default derived (e.g. "Practice", "vs Brookings")
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    resourceId: uuid("resource_id").references(() => resources.id),
    bookingId: uuid("booking_id").references(() => resourceBookings.id),
    locationText: text("location_text"), // away / off-site address
    opponent: text("opponent"),
    site: teamEventSiteEnum("site"), // games only
    seriesId: uuid("series_id"), // recurring practices
    notes: text("notes"),
    status: teamEventStatusEnum("status").notNull().default("scheduled"),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByUserId: text("cancelled_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("team_events_team_idx").on(t.teamId, t.startsAt),
    index("team_events_series_idx").on(t.seriesId),
    check("team_events_window_chk", sql`${t.endsAt} > ${t.startsAt}`),
    check("team_events_booking_chk", sql`${t.bookingId} is null or ${t.resourceId} is not null`),
  ]
);
