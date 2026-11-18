import "server-only";
import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { boardMeetingAttendance, boardMeetings, boardMinutes, boardMotions } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { laDateTimeInputToUtc } from "@/lib/format";
import {
  approveMinutesSchema,
  attendanceEntriesSchema,
  boardIdSchema,
  listMeetingsSchema,
  meetingInputSchema,
  minutesBodySchema,
  type AttendanceEntry,
  type MeetingInput,
} from "@/lib/validation/board";
import { listSeatedDirectors, requireBoardModule } from "./board-shared";
import { listBoardMembers, type BoardMemberView } from "./board-members";
import { DalError, type SessionContext } from "./context";

export type MeetingRecord = typeof boardMeetings.$inferSelect;
export type MinutesRecord = typeof boardMinutes.$inferSelect;
export type MinutesState = "none" | "draft" | "approved" | "public";

/** A meeting is "upcoming" until it is marked held or its end (default start + 2h) passes. */
const upcomingSql = (now: Date) =>
  and(ne(boardMeetings.status, "held"), sql`coalesce(${boardMeetings.endsAt}, ${boardMeetings.startsAt} + interval '2 hours') >= ${now}`);

export interface MeetingListRow extends MeetingRecord {
  /** Seats recorded present or remote. */
  attendedCount: number;
  attendanceRecorded: number;
  minutesState: MinutesState;
}

function minutesStateOf(rows: { version: number; status: "draft" | "approved"; isPublic: boolean }[]): MinutesState {
  if (rows.length === 0) return "none";
  if (rows.some((r) => r.isPublic)) return "public";
  const latest = rows.reduce((a, b) => (b.version > a.version ? b : a));
  return latest.status === "draft" ? "draft" : "approved";
}

export async function listMeetings(
  ctx: SessionContext,
  opts: { range?: "upcoming" | "past" | "all" } = {},
  now: Date = new Date()
): Promise<MeetingListRow[]> {
  requireBoardModule(ctx);
  const { range } = listMeetingsSchema.parse(opts);
  const where = range === "upcoming" ? upcomingSql(now) : range === "past" ? sql`not (${upcomingSql(now)})` : undefined;
  const meetings = await db
    .select()
    .from(boardMeetings)
    .where(where)
    .orderBy(range === "upcoming" ? asc(boardMeetings.startsAt) : desc(boardMeetings.startsAt))
    .limit(300);
  if (meetings.length === 0) return [];
  const ids = meetings.map((m) => m.id);
  const [att, mins] = await Promise.all([
    db
      .select({
        meetingId: boardMeetingAttendance.meetingId,
        recorded: count(),
        attended: sql<number>`count(*) filter (where ${boardMeetingAttendance.status} in ('present','remote'))`.mapWith(Number),
      })
      .from(boardMeetingAttendance)
      .where(inArray(boardMeetingAttendance.meetingId, ids))
      .groupBy(boardMeetingAttendance.meetingId),
    db
      .select({ meetingId: boardMinutes.meetingId, version: boardMinutes.version, status: boardMinutes.status, isPublic: boardMinutes.isPublic })
      .from(boardMinutes)
      .where(inArray(boardMinutes.meetingId, ids)),
  ]);
  return meetings.map((m) => ({
    ...m,
    attendedCount: att.find((a) => a.meetingId === m.id)?.attended ?? 0,
    attendanceRecorded: att.find((a) => a.meetingId === m.id)?.recorded ?? 0,
    minutesState: minutesStateOf(mins.filter((x) => x.meetingId === m.id)),
  }));
}

export interface MeetingSeatRow {
  boardMemberId: string;
  displayName: string;
  position: string;
  status: (typeof boardMeetingAttendance.$inferSelect)["status"] | null;
  recordedAt: Date | null;
}

export interface MeetingDetail {
  meeting: MeetingRecord;
  /** Voting seats seated at the meeting start, with any recorded attendance. */
  seats: MeetingSeatRow[];
  /** Newest first, with bodies (board only). */
  minutes: MinutesRecord[];
}

export async function getMeeting(ctx: SessionContext, id: string): Promise<MeetingDetail> {
  requireBoardModule(ctx);
  const meetingId = boardIdSchema.parse(id);
  const [meeting] = await db.select().from(boardMeetings).where(eq(boardMeetings.id, meetingId)).limit(1);
  if (!meeting) throw new DalError("NOT_FOUND", "Meeting not found.");
  const [seated, att, minutes] = await Promise.all([
    listSeatedDirectors(meeting.startsAt),
    db.select().from(boardMeetingAttendance).where(eq(boardMeetingAttendance.meetingId, meetingId)),
    db.select().from(boardMinutes).where(eq(boardMinutes.meetingId, meetingId)).orderBy(desc(boardMinutes.version)),
  ]);
  return {
    meeting,
    seats: seated.map((s) => {
      const a = att.find((x) => x.boardMemberId === s.id);
      return { boardMemberId: s.id, displayName: s.displayName, position: s.position, status: a?.status ?? null, recordedAt: a?.recordedAt ?? null };
    }),
    minutes,
  };
}

export async function createMeeting(ctx: SessionContext, input: MeetingInput): Promise<{ id: string }> {
  requireBoardModule(ctx);
  const v = meetingInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const [m] = await tx
      .insert(boardMeetings)
      .values({
        title: v.title,
        kind: v.kind,
        startsAt: laDateTimeInputToUtc(v.startsAt),
        endsAt: v.endsAt ? laDateTimeInputToUtc(v.endsAt) : null,
        location: v.location,
        virtualUrl: v.virtualUrl,
        agenda: v.agenda,
        isPublic: v.isPublic,
        createdByUserId: ctx.userId,
      })
      .returning({ id: boardMeetings.id });
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_meeting.created", targetType: "board_meeting", targetId: m.id, metadata: { title: v.title, kind: v.kind, startsAt: v.startsAt, isPublic: v.isPublic } },
      tx
    );
    return m;
  });
}

export async function updateMeeting(ctx: SessionContext, id: string, input: MeetingInput): Promise<void> {
  requireBoardModule(ctx);
  const meetingId = boardIdSchema.parse(id);
  const v = meetingInputSchema.parse(input);
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(boardMeetings).where(eq(boardMeetings.id, meetingId)).for("update");
    if (!m) throw new DalError("NOT_FOUND", "Meeting not found.");
    if (m.status === "cancelled") throw new DalError("INVALID", "A cancelled meeting can't be edited.");
    const startsAt = laDateTimeInputToUtc(v.startsAt);
    if (startsAt.getTime() !== m.startsAt.getTime()) {
      // Attendance is tied to the seats seated at the start, so the start is fixed once recorded.
      const [att] = await tx.select({ id: boardMeetingAttendance.id }).from(boardMeetingAttendance).where(eq(boardMeetingAttendance.meetingId, meetingId)).limit(1);
      if (att) throw new DalError("INVALID", "Attendance is already recorded, so the start time can't change.");
    }
    await tx
      .update(boardMeetings)
      .set({
        title: v.title,
        kind: v.kind,
        startsAt,
        endsAt: v.endsAt ? laDateTimeInputToUtc(v.endsAt) : null,
        location: v.location,
        virtualUrl: v.virtualUrl,
        agenda: v.agenda,
        isPublic: v.isPublic,
      })
      .where(eq(boardMeetings.id, meetingId));
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_meeting.updated", targetType: "board_meeting", targetId: meetingId, metadata: { title: v.title, startsAt: v.startsAt, isPublic: v.isPublic, wasPublic: m.isPublic } },
      tx
    );
  });
}

export async function cancelMeeting(ctx: SessionContext, id: string, opts: { reason?: string } = {}): Promise<void> {
  requireBoardModule(ctx);
  const meetingId = boardIdSchema.parse(id);
  const reason = (opts.reason ?? "").trim().slice(0, 500) || null;
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(boardMeetings).where(eq(boardMeetings.id, meetingId)).for("update");
    if (!m) throw new DalError("NOT_FOUND", "Meeting not found.");
    if (m.status !== "scheduled") throw new DalError("INVALID", m.status === "held" ? "A meeting that was held can't be cancelled." : "This meeting is already cancelled.");
    await tx.update(boardMeetings).set({ status: "cancelled" }).where(eq(boardMeetings.id, meetingId));
    await writeAudit({ actorUserId: ctx.userId, action: "board_meeting.cancelled", targetType: "board_meeting", targetId: meetingId, metadata: { title: m.title, reason } }, tx);
  });
}

export async function markMeetingHeld(ctx: SessionContext, id: string, now: Date = new Date()): Promise<void> {
  requireBoardModule(ctx);
  const meetingId = boardIdSchema.parse(id);
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(boardMeetings).where(eq(boardMeetings.id, meetingId)).for("update");
    if (!m) throw new DalError("NOT_FOUND", "Meeting not found.");
    if (m.status !== "scheduled") throw new DalError("INVALID", m.status === "held" ? "This meeting is already marked as held." : "A cancelled meeting can't be marked as held.");
    if (m.startsAt.getTime() > now.getTime()) throw new DalError("INVALID", "This meeting hasn't started yet.");
    await tx.update(boardMeetings).set({ status: "held" }).where(eq(boardMeetings.id, meetingId));
    await writeAudit({ actorUserId: ctx.userId, action: "board_meeting.updated", targetType: "board_meeting", targetId: meetingId, metadata: { status: "held" } }, tx);
  });
}

/**
 * Upserts attendance. Only voting seats seated at the meeting's start may be recorded;
 * seats not listed are left untouched.
 */
export async function recordAttendance(ctx: SessionContext, meetingId: string, entries: AttendanceEntry[]): Promise<{ recorded: number }> {
  requireBoardModule(ctx);
  const id = boardIdSchema.parse(meetingId);
  const rows = attendanceEntriesSchema.parse(entries);
  if (rows.length === 0) throw new DalError("INVALID", "Choose an attendance status for at least one director.");
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(boardMeetings).where(eq(boardMeetings.id, id)).for("update");
    if (!m) throw new DalError("NOT_FOUND", "Meeting not found.");
    if (m.status === "cancelled") throw new DalError("INVALID", "A cancelled meeting has no attendance.");
    const seated = new Set((await listSeatedDirectors(m.startsAt, tx)).map((s) => s.id));
    if (rows.some((r) => !seated.has(r.boardMemberId))) {
      throw new DalError("INVALID", "Attendance can only be recorded for directors who held a voting seat when the meeting started.");
    }
    const now = new Date();
    for (const r of rows) {
      await tx
        .insert(boardMeetingAttendance)
        .values({ meetingId: id, boardMemberId: r.boardMemberId, status: r.status, recordedByUserId: ctx.userId, recordedAt: now })
        .onConflictDoUpdate({
          target: [boardMeetingAttendance.meetingId, boardMeetingAttendance.boardMemberId],
          set: { status: r.status, recordedByUserId: ctx.userId, recordedAt: now },
        });
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "board_attendance.recorded",
        targetType: "board_meeting",
        targetId: id,
        metadata: { entries: rows.map((r) => ({ boardMemberId: r.boardMemberId, status: r.status })) },
      },
      tx
    );
    return { recorded: rows.length };
  });
}

// ---------------------------------------------------------------------------
// Minutes (versioned; an approved version is immutable, only isPublic may change)
// ---------------------------------------------------------------------------

/**
 * Creates or updates the latest draft. If the latest version is approved, creates
 * version n+1 as a new draft (a correction). Approved rows are never updated here.
 */
export async function saveMinutesDraft(ctx: SessionContext, meetingId: string, body: string): Promise<{ id: string; version: number; created: boolean }> {
  requireBoardModule(ctx);
  const id = boardIdSchema.parse(meetingId);
  const text = minutesBodySchema.parse(body);
  return db.transaction(async (tx) => {
    // Serialize version assignment per meeting.
    const [m] = await tx.select({ id: boardMeetings.id, status: boardMeetings.status }).from(boardMeetings).where(eq(boardMeetings.id, id)).for("update");
    if (!m) throw new DalError("NOT_FOUND", "Meeting not found.");
    if (m.status === "cancelled") throw new DalError("INVALID", "A cancelled meeting has no minutes.");
    const [latest] = await tx.select().from(boardMinutes).where(eq(boardMinutes.meetingId, id)).orderBy(desc(boardMinutes.version)).limit(1);
    let row: { id: string; version: number };
    let created = false;
    if (latest && latest.status === "draft") {
      [row] = await tx
        .update(boardMinutes)
        .set({ body: text })
        .where(and(eq(boardMinutes.id, latest.id), eq(boardMinutes.status, "draft")))
        .returning({ id: boardMinutes.id, version: boardMinutes.version });
    } else {
      created = true;
      [row] = await tx
        .insert(boardMinutes)
        .values({ meetingId: id, version: (latest?.version ?? 0) + 1, body: text, status: "draft", createdByUserId: ctx.userId })
        .returning({ id: boardMinutes.id, version: boardMinutes.version });
    }
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_minutes.saved", targetType: "board_minutes", targetId: row.id, metadata: { meetingId: id, version: row.version, created, length: text.length } },
      tx
    );
    return { ...row, created };
  });
}

export async function approveMinutes(ctx: SessionContext, minutesId: string, opts: { motionId?: string | null } = {}): Promise<{ version: number }> {
  requireBoardModule(ctx);
  const id = boardIdSchema.parse(minutesId);
  const { motionId } = approveMinutesSchema.parse(opts);
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(boardMinutes).where(eq(boardMinutes.id, id)).for("update");
    if (!m) throw new DalError("NOT_FOUND", "Minutes not found.");
    if (m.status === "approved") throw new DalError("INVALID", "These minutes are already approved. Write a correction as a new version.");
    if (motionId) {
      const [mo] = await tx.select({ id: boardMotions.id }).from(boardMotions).where(eq(boardMotions.id, motionId)).limit(1);
      if (!mo) throw new DalError("INVALID", "That motion doesn't exist.");
    }
    const [row] = await tx
      .update(boardMinutes)
      .set({ status: "approved", approvedAt: new Date(), approvedByUserId: ctx.userId, approvedViaMotionId: motionId })
      .where(and(eq(boardMinutes.id, id), eq(boardMinutes.status, "draft")))
      .returning({ version: boardMinutes.version });
    if (!row) throw new DalError("INVALID", "These minutes were already approved.");
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_minutes.approved", targetType: "board_minutes", targetId: id, metadata: { meetingId: m.meetingId, version: m.version, motionId } },
      tx
    );
    return row;
  });
}

/**
 * Publish or unpublish approved minutes. Publishing a version unpublishes older public
 * versions of the same meeting, so members only ever see one (the corrected) version.
 */
export async function setMinutesPublic(ctx: SessionContext, minutesId: string, isPublic: boolean): Promise<void> {
  requireBoardModule(ctx);
  const id = boardIdSchema.parse(minutesId);
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(boardMinutes).where(eq(boardMinutes.id, id)).for("update");
    if (!m) throw new DalError("NOT_FOUND", "Minutes not found.");
    if (m.status !== "approved") throw new DalError("INVALID", "Only approved minutes can be made public.");
    await tx.update(boardMinutes).set({ isPublic }).where(eq(boardMinutes.id, id));
    let superseded: number[] = [];
    if (isPublic) {
      const old = await tx
        .update(boardMinutes)
        .set({ isPublic: false })
        .where(and(eq(boardMinutes.meetingId, m.meetingId), ne(boardMinutes.id, id), eq(boardMinutes.isPublic, true)))
        .returning({ version: boardMinutes.version });
      superseded = old.map((o) => o.version);
    }
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_minutes.published", targetType: "board_minutes", targetId: id, metadata: { meetingId: m.meetingId, version: m.version, isPublic, unpublishedVersions: superseded } },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Overview (board)
// ---------------------------------------------------------------------------
export interface BoardOverview {
  members: BoardMemberView[];
  seatedVotingCount: number;
  nextMeeting: MeetingRecord | null;
  openMotions: number;
  minutesAwaiting: { minutesId: string; meetingId: string; meetingTitle: string; startsAt: Date; version: number }[];
  seatsWithoutAccount: number;
}

export async function getBoardOverview(ctx: SessionContext, now: Date = new Date()): Promise<BoardOverview> {
  requireBoardModule(ctx);
  const [members, seated, [next], [open], drafts] = await Promise.all([
    listBoardMembers(ctx, { include: "current" }, now),
    listSeatedDirectors(now),
    db.select().from(boardMeetings).where(and(eq(boardMeetings.status, "scheduled"), sql`${boardMeetings.startsAt} >= ${now}`)).orderBy(asc(boardMeetings.startsAt)).limit(1),
    db.select({ n: count() }).from(boardMotions).where(eq(boardMotions.status, "open")),
    // Meetings whose newest minutes version is still a draft.
    db
      .select({ minutesId: boardMinutes.id, meetingId: boardMinutes.meetingId, meetingTitle: boardMeetings.title, startsAt: boardMeetings.startsAt, version: boardMinutes.version })
      .from(boardMinutes)
      .innerJoin(boardMeetings, eq(boardMeetings.id, boardMinutes.meetingId))
      .where(and(eq(boardMinutes.status, "draft"), ne(boardMeetings.status, "cancelled")))
      .orderBy(desc(boardMeetings.startsAt)),
  ]);
  return {
    members,
    seatedVotingCount: seated.length,
    nextMeeting: next ?? null,
    openMotions: open?.n ?? 0,
    minutesAwaiting: drafts,
    seatsWithoutAccount: seated.filter((s) => !s.userId).length,
  };
}

// ---------------------------------------------------------------------------
// Member-facing (any signed-in user): public meetings and public approved minutes only
// ---------------------------------------------------------------------------
export interface PublicMinutes {
  version: number;
  body: string;
  approvedAt: Date | null;
}

export interface PublicMeeting {
  id: string;
  title: string;
  kind: MeetingRecord["kind"];
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  virtualUrl: string | null;
  agenda: string | null;
  status: MeetingRecord["status"];
  hasMinutes: boolean;
}

const publicCols = {
  id: boardMeetings.id,
  title: boardMeetings.title,
  kind: boardMeetings.kind,
  startsAt: boardMeetings.startsAt,
  endsAt: boardMeetings.endsAt,
  location: boardMeetings.location,
  virtualUrl: boardMeetings.virtualUrl,
  agenda: boardMeetings.agenda,
  status: boardMeetings.status,
};

function requireSignedIn(ctx: SessionContext | null | undefined): asserts ctx is SessionContext {
  if (!ctx?.userId) throw new DalError("UNAUTHENTICATED", "Please sign in.");
}

export async function listPublicMeetings(ctx: SessionContext, now: Date = new Date()): Promise<{ upcoming: PublicMeeting[]; past: PublicMeeting[] }> {
  requireSignedIn(ctx);
  const rows = await db.select(publicCols).from(boardMeetings).where(eq(boardMeetings.isPublic, true)).orderBy(desc(boardMeetings.startsAt)).limit(300);
  const ids = rows.map((r) => r.id);
  const withMinutes = new Set(
    ids.length
      ? (
          await db
            .select({ meetingId: boardMinutes.meetingId })
            .from(boardMinutes)
            .where(and(inArray(boardMinutes.meetingId, ids), eq(boardMinutes.status, "approved"), eq(boardMinutes.isPublic, true)))
        ).map((r) => r.meetingId)
      : []
  );
  const isUpcoming = (m: (typeof rows)[number]) =>
    m.status !== "held" && (m.endsAt ?? new Date(m.startsAt.getTime() + 2 * 3600_000)).getTime() >= now.getTime();
  const all = rows.map((r): PublicMeeting => ({ ...r, hasMinutes: withMinutes.has(r.id) }));
  return {
    upcoming: all.filter(isUpcoming).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    past: all.filter((m) => !isUpcoming(m) && m.status !== "cancelled"),
  };
}

export async function getPublicMeeting(ctx: SessionContext, id: string): Promise<{ meeting: PublicMeeting; minutes: PublicMinutes | null }> {
  requireSignedIn(ctx);
  const parsed = boardIdSchema.safeParse(id);
  if (!parsed.success) throw new DalError("NOT_FOUND", "Meeting not found.");
  const [m] = await db.select(publicCols).from(boardMeetings).where(and(eq(boardMeetings.id, parsed.data), eq(boardMeetings.isPublic, true))).limit(1);
  if (!m) throw new DalError("NOT_FOUND", "Meeting not found.");
  const [min] = await db
    .select({ version: boardMinutes.version, body: boardMinutes.body, approvedAt: boardMinutes.approvedAt })
    .from(boardMinutes)
    .where(and(eq(boardMinutes.meetingId, m.id), eq(boardMinutes.status, "approved"), eq(boardMinutes.isPublic, true)))
    .orderBy(desc(boardMinutes.version))
    .limit(1);
  return { meeting: { ...m, hasMinutes: !!min }, minutes: min ?? null };
}

