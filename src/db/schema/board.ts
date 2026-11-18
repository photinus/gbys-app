import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uuid,
  date,
  pgEnum,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Board of Directors module. Management is board-only (isBoard). Voting rights
 * come from board_members (seated directors linked to a user account), NOT from
 * users.orgRole. Members may see meetings with isPublic and approved minutes with
 * isPublic. Votes and approved minutes are immutable.
 */

export const boardMeetingKindEnum = pgEnum("board_meeting_kind", ["regular", "special", "annual"]);
export const boardMeetingStatusEnum = pgEnum("board_meeting_status", ["scheduled", "held", "cancelled"]);
export const boardAttendanceEnum = pgEnum("board_attendance_status", ["present", "remote", "absent", "excused"]);
export const boardMinutesStatusEnum = pgEnum("board_minutes_status", ["draft", "approved"]);
export const boardMotionKindEnum = pgEnum("board_motion_kind", ["in_meeting", "without_meeting"]);
export const boardMotionThresholdEnum = pgEnum("board_motion_threshold", [
  "majority_of_votes_cast",
  "two_thirds_of_votes_cast",
  "unanimous_of_directors",
]);
export const boardMotionStatusEnum = pgEnum("board_motion_status", ["draft", "open", "passed", "failed", "withdrawn"]);
export const boardVoteChoiceEnum = pgEnum("board_vote_choice", ["yes", "no", "abstain"]);

/** A board seat / term. Seated at instant t: isVotingDirector, termStart <= t, termEnd null or >= t, not ended. */
export const boardMembers = pgTable(
  "board_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => users.id), // required to vote electronically
    displayName: text("display_name").notNull(),
    position: text("position").notNull(), // President, Vice President, Treasurer, Secretary, Director...
    isVotingDirector: boolean("is_voting_director").notNull().default(true),
    termStart: date("term_start", { mode: "string" }).notNull(),
    termEnd: date("term_end", { mode: "string" }), // null = open-ended
    electedOn: date("elected_on", { mode: "string" }),
    endedAt: timestamp("ended_at", { withTimezone: true }), // early resignation/removal
    endReason: text("end_reason"),
    notes: text("notes"),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("board_members_user_idx").on(t.userId),
    check("board_members_term_chk", sql`${t.termEnd} is null or ${t.termEnd} >= ${t.termStart}`),
  ]
);

export const boardMeetings = pgTable(
  "board_meetings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    kind: boardMeetingKindEnum("kind").notNull().default("regular"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    virtualUrl: text("virtual_url"),
    agenda: text("agenda"),
    status: boardMeetingStatusEnum("status").notNull().default("scheduled"),
    isPublic: boolean("is_public").notNull().default(true), // members see it on the schedule
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("board_meetings_starts_idx").on(t.startsAt),
    check("board_meetings_window_chk", sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ]
);

export const boardMeetingAttendance = pgTable(
  "board_meeting_attendance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => boardMeetings.id),
    boardMemberId: uuid("board_member_id")
      .notNull()
      .references(() => boardMembers.id),
    status: boardAttendanceEnum("status").notNull(),
    recordedByUserId: text("recorded_by_user_id").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("board_attendance_unique_idx").on(t.meetingId, t.boardMemberId)]
);

/**
 * Versioned minutes. A draft may be edited; an approved version is immutable
 * (only isPublic may change). Corrections = a new version approved later.
 */
export const boardMinutes = pgTable(
  "board_minutes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => boardMeetings.id),
    version: integer("version").notNull(),
    body: text("body").notNull(), // Markdown
    status: boardMinutesStatusEnum("status").notNull().default("draft"),
    isPublic: boolean("is_public").notNull().default(false),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByUserId: text("approved_by_user_id").references(() => users.id),
    approvedViaMotionId: uuid("approved_via_motion_id"), // board_motions.id (soft link)
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("board_minutes_version_idx").on(t.meetingId, t.version),
    check("board_minutes_public_chk", sql`not ${t.isPublic} or ${t.status} = 'approved'`),
  ]
);

/**
 * A motion. in_meeting: tied to a meeting; quorum from recorded attendance;
 * passes by the threshold of votes cast. without_meeting (Oregon "action without
 * a meeting"): every eligible director must vote yes (threshold forced to
 * unanimous_of_directors). eligibleBoardMemberIds and result are snapshotted.
 */
export const boardMotions = pgTable(
  "board_motions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    meetingId: uuid("meeting_id").references(() => boardMeetings.id),
    kind: boardMotionKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    threshold: boardMotionThresholdEnum("threshold").notNull().default("majority_of_votes_cast"),
    quorumRequired: integer("quorum_required"), // snapshot at open (in_meeting)
    status: boardMotionStatusEnum("status").notNull().default("draft"),
    eligibleBoardMemberIds: jsonb("eligible_board_member_ids").$type<string[]>().notNull().default([]),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    movedByBoardMemberId: uuid("moved_by_board_member_id").references(() => boardMembers.id),
    secondedByBoardMemberId: uuid("seconded_by_board_member_id").references(() => boardMembers.id),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("board_motions_meeting_idx").on(t.meetingId),
    check("board_motions_meeting_chk", sql`${t.kind} <> 'in_meeting' or ${t.meetingId} is not null`),
    check(
      "board_motions_wom_unanimous_chk",
      sql`${t.kind} <> 'without_meeting' or ${t.threshold} = 'unanimous_of_directors'`
    ),
  ]
);

/**
 * Immutable vote record: one per (motion, seat), never updated or deleted.
 * without_meeting votes must be cast by the director themselves
 * (recordedByUserId = userId); in-meeting roll-call votes may be recorded by
 * the secretary/chair (recordedByUserId differs, audited).
 */
export const boardVotes = pgTable(
  "board_votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    motionId: uuid("motion_id")
      .notNull()
      .references(() => boardMotions.id),
    boardMemberId: uuid("board_member_id")
      .notNull()
      .references(() => boardMembers.id),
    userId: text("user_id").references(() => users.id), // the director's account (null if seat has no account)
    choice: boardVoteChoiceEnum("choice").notNull(),
    recordedByUserId: text("recorded_by_user_id")
      .notNull()
      .references(() => users.id),
    castAt: timestamp("cast_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("board_votes_unique_idx").on(t.motionId, t.boardMemberId)]
);
