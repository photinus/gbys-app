import "server-only";
import { and, desc, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import { db, type DbTx } from "@/db";
import { boardMeetingAttendance, boardMeetings, boardMembers, boardMotions, boardVotes, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sendBoardVoteRequestEmail } from "@/lib/email";
import {
  MIN_WRITTEN_CONSENT_HOURS,
  motionInputSchema,
  reasonSchema,
  voteChoiceSchema,
  type MotionInput,
  type MotionKind,
  type MotionStatus,
  type MotionThreshold,
  type VoteChoice,
} from "@/lib/validation/board-motions";
import { defaultQuorum, getMySeat, listSeatedDirectors, requireBoardModule } from "./board-shared";
import { DalError, type SessionContext } from "./context";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DalError("INVALID", r.error.issues[0]?.message ?? "Invalid input.");
  return r.data;
}

function parseId(id: string, what = "Motion"): string {
  if (typeof id !== "string" || !uuidRe.test(id)) throw new DalError("NOT_FOUND", `${what} not found.`);
  return id;
}

type MotionRow = typeof boardMotions.$inferSelect;

export interface MotionResult {
  yes: number;
  no: number;
  abstain: number;
  cast: number;
  eligible: number;
  present?: number;
  quorum?: number;
  passed: boolean;
  reason: string;
  trigger: "manual" | "deadline" | "early_pass" | "early_fail";
}

const PRESENT_STATUSES = ["present", "remote"] as const;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function lockMotion(tx: DbTx, id: string): Promise<MotionRow> {
  const [m] = await tx.select().from(boardMotions).where(eq(boardMotions.id, id)).for("update").limit(1);
  if (!m) throw new DalError("NOT_FOUND", "Motion not found.");
  return m;
}

/** Seats marked present or remote at a meeting, restricted to `seatIds`. */
async function presentSeatIds(tx: DbTx, meetingId: string, seatIds: string[]): Promise<string[]> {
  if (seatIds.length === 0) return [];
  const rows = await tx
    .select({ id: boardMeetingAttendance.boardMemberId })
    .from(boardMeetingAttendance)
    .where(
      and(
        eq(boardMeetingAttendance.meetingId, meetingId),
        inArray(boardMeetingAttendance.status, [...PRESENT_STATUSES]),
        inArray(boardMeetingAttendance.boardMemberId, seatIds)
      )
    );
  return rows.map((r) => r.id);
}

/** Compute and snapshot the result, set passed/failed, and audit. Caller holds the motion row lock. */
async function finalizeMotion(
  tx: DbTx,
  motion: MotionRow,
  trigger: MotionResult["trigger"],
  actorUserId: string | null,
  now: Date
): Promise<{ status: "passed" | "failed"; result: MotionResult }> {
  const eligibleIds = motion.eligibleBoardMemberIds;
  const votes = await tx
    .select({ choice: boardVotes.choice, boardMemberId: boardVotes.boardMemberId })
    .from(boardVotes)
    .where(eq(boardVotes.motionId, motion.id));
  const eligibleSet = new Set(eligibleIds);
  const counted = votes.filter((v) => eligibleSet.has(v.boardMemberId));
  const yes = counted.filter((v) => v.choice === "yes").length;
  const no = counted.filter((v) => v.choice === "no").length;
  const abstain = counted.filter((v) => v.choice === "abstain").length;
  const cast = yes + no; // abstentions are not votes cast
  const eligible = eligibleIds.length;

  let passed = false;
  let reason = "";
  let present: number | undefined;
  let quorum: number | undefined;

  if (motion.kind === "in_meeting") {
    quorum = motion.quorumRequired ?? defaultQuorum(eligible);
    present = motion.meetingId ? (await presentSeatIds(tx, motion.meetingId, eligibleIds)).length : 0;
  }

  const tallyText = `${yes} yes, ${no} no, ${abstain} abstain`;
  if (quorum !== undefined && (present ?? 0) < quorum) {
    reason = `Failed: no quorum at close (${present} of ${eligible} directors present, ${quorum} required). ${tallyText}.`;
  } else if (motion.threshold === "majority_of_votes_cast") {
    passed = yes > no; // strictly more than half of yes+no; a tie fails
    reason = passed
      ? `Passed: ${tallyText}. Majority of votes cast.`
      : cast === 0
        ? `Failed: no yes or no votes were cast. ${tallyText}.`
        : `Failed: yes votes were not a majority of votes cast. ${tallyText}.`;
  } else if (motion.threshold === "two_thirds_of_votes_cast") {
    passed = cast > 0 && 3 * yes >= 2 * cast;
    reason = passed
      ? `Passed: ${tallyText}. At least two-thirds of votes cast.`
      : cast === 0
        ? `Failed: no yes or no votes were cast. ${tallyText}.`
        : `Failed: yes votes were less than two-thirds of votes cast. ${tallyText}.`;
  } else {
    passed = eligible > 0 && yes === eligible;
    const missing = eligible - counted.length;
    reason = passed
      ? `Passed: all ${eligible} eligible directors voted yes.`
      : `Failed: every eligible director must vote yes. ${tallyText}${missing > 0 ? `, ${missing} did not vote` : ""}.`;
  }

  const result: MotionResult = { yes, no, abstain, cast, eligible, passed, reason, trigger };
  if (quorum !== undefined) {
    result.present = present;
    result.quorum = quorum;
  }
  const status = passed ? "passed" : "failed";
  await tx
    .update(boardMotions)
    .set({ status, closedAt: now, result: { ...result } })
    .where(and(eq(boardMotions.id, motion.id), eq(boardMotions.status, "open")));
  await writeAudit(
    {
      actorUserId,
      action: "board_motion.closed",
      targetType: "board_motion",
      targetId: motion.id,
      metadata: { status, ...result },
    },
    tx
  );
  return { status, result };
}

/** Lazy close: finalize open motions whose closesAt has passed. Safe to call from any read path. */
async function closeExpired(motionId?: string): Promise<void> {
  const now = new Date();
  const cands = await db
    .select({ id: boardMotions.id })
    .from(boardMotions)
    .where(
      and(
        eq(boardMotions.status, "open"),
        isNotNull(boardMotions.closesAt),
        lte(boardMotions.closesAt, now),
        motionId ? eq(boardMotions.id, motionId) : undefined
      )
    );
  for (const c of cands) {
    await db.transaction(async (tx) => {
      const m = await lockMotion(tx, c.id);
      if (m.status === "open" && m.closesAt && m.closesAt <= now) {
        await finalizeMotion(tx, m, "deadline", null, now);
      }
    });
  }
}

async function assertMeetingUsable(tx: DbTx, meetingId: string): Promise<void> {
  const [mtg] = await tx.select({ status: boardMeetings.status }).from(boardMeetings).where(eq(boardMeetings.id, meetingId)).limit(1);
  if (!mtg) throw new DalError("INVALID", "That meeting does not exist.");
  if (mtg.status === "cancelled") throw new DalError("INVALID", "That meeting was cancelled.");
}

async function assertSeatsExist(tx: DbTx, ids: (string | null)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return;
  const rows = await tx.select({ id: boardMembers.id }).from(boardMembers).where(inArray(boardMembers.id, wanted));
  if (rows.length !== wanted.length) throw new DalError("INVALID", "The mover or seconder is not a board seat.");
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

export async function createMotion(ctx: SessionContext, input: unknown): Promise<{ id: string }> {
  requireBoardModule(ctx);
  const v: MotionInput = parseInput(motionInputSchema, input);
  return db.transaction(async (tx) => {
    if (v.kind === "in_meeting" && v.meetingId) await assertMeetingUsable(tx, v.meetingId);
    await assertSeatsExist(tx, [v.movedBy, v.secondedBy]);
    const [row] = await tx
      .insert(boardMotions)
      .values({
        kind: v.kind,
        meetingId: v.meetingId,
        title: v.title,
        body: v.body,
        threshold: v.threshold,
        movedByBoardMemberId: v.movedBy,
        secondedByBoardMemberId: v.secondedBy,
        createdByUserId: ctx.userId,
      })
      .returning({ id: boardMotions.id });
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_motion.created", targetType: "board_motion", targetId: row.id, metadata: { kind: v.kind, threshold: v.threshold, title: v.title } },
      tx
    );
    return row;
  });
}

export async function updateMotion(ctx: SessionContext, id: string, input: unknown): Promise<void> {
  requireBoardModule(ctx);
  parseId(id);
  const v: MotionInput = parseInput(motionInputSchema, input);
  await db.transaction(async (tx) => {
    const m = await lockMotion(tx, id);
    if (m.status !== "draft") throw new DalError("INVALID", "Only a draft motion can be edited.");
    if (v.kind === "in_meeting" && v.meetingId) await assertMeetingUsable(tx, v.meetingId);
    await assertSeatsExist(tx, [v.movedBy, v.secondedBy]);
    await tx
      .update(boardMotions)
      .set({
        kind: v.kind,
        meetingId: v.meetingId,
        title: v.title,
        body: v.body,
        threshold: v.threshold,
        movedByBoardMemberId: v.movedBy,
        secondedByBoardMemberId: v.secondedBy,
      })
      .where(eq(boardMotions.id, id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_motion.updated", targetType: "board_motion", targetId: id, metadata: { kind: v.kind, threshold: v.threshold, title: v.title } },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Open / vote / close / withdraw
// ---------------------------------------------------------------------------

export async function openMotion(
  ctx: SessionContext,
  id: string,
  opts: { closesAt?: Date | null } = {}
): Promise<{ eligible: number; emailed: number }> {
  requireBoardModule(ctx);
  parseId(id);
  const recipients: { email: string; name: string }[] = [];
  let title = "";
  let closesAt: Date | null = null;

  const out = await db.transaction(async (tx) => {
    const m = await lockMotion(tx, id);
    if (m.status !== "draft") throw new DalError("INVALID", "Only a draft motion can be opened.");
    const now = new Date();
    const seated = await listSeatedDirectors(now, tx);
    if (seated.length === 0) throw new DalError("INVALID", "There are no seated voting directors, so no one is eligible to vote.");
    const eligibleIds = seated.map((s) => s.id);
    title = m.title;

    let quorumRequired: number | null = null;
    if (m.kind === "in_meeting") {
      if (!m.meetingId) throw new DalError("INVALID", "This motion is not tied to a meeting.");
      await assertMeetingUsable(tx, m.meetingId);
      const present = (await presentSeatIds(tx, m.meetingId, eligibleIds)).length;
      quorumRequired = defaultQuorum(seated.length);
      if (present < quorumRequired) {
        throw new DalError(
          "INVALID",
          `No quorum: ${present} of ${seated.length} directors are recorded present or remote, and ${quorumRequired} are required. Record attendance first.`
        );
      }
      closesAt = null;
    } else {
      const c = opts.closesAt ?? null;
      if (!c || Number.isNaN(c.getTime())) throw new DalError("INVALID", "Choose when voting closes.");
      if (c.getTime() < now.getTime() + MIN_WRITTEN_CONSENT_HOURS * 3_600_000) {
        throw new DalError("INVALID", `Voting on an action without a meeting must stay open at least ${MIN_WRITTEN_CONSENT_HOURS} hours.`);
      }
      closesAt = c;
      // Every eligible seat must be able to vote, otherwise unanimity is impossible.
      const userIds = seated.map((s) => s.userId).filter((u): u is string => !!u);
      const accts = userIds.length
        ? await tx.select({ id: users.id, email: users.email, name: users.name, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, userIds))
        : [];
      const live = new Map(accts.filter((a) => !a.deletedAt).map((a) => [a.id, a]));
      const missing = seated.filter((s) => !s.userId || !live.has(s.userId));
      if (missing.length > 0) {
        throw new DalError(
          "INVALID",
          `These directors have no active linked account and cannot vote electronically, so unanimous consent is impossible: ${missing.map((s) => s.displayName).join(", ")}. Link their accounts first.`
        );
      }
      for (const s of seated) {
        const a = live.get(s.userId!)!;
        recipients.push({ email: a.email, name: s.displayName });
      }
    }

    await tx
      .update(boardMotions)
      .set({ status: "open", openedAt: now, closesAt, eligibleBoardMemberIds: eligibleIds, quorumRequired })
      .where(eq(boardMotions.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "board_motion.opened",
        targetType: "board_motion",
        targetId: id,
        metadata: { kind: m.kind, eligible: eligibleIds.length, quorumRequired, closesAt: closesAt?.toISOString() ?? null, eligibleBoardMemberIds: eligibleIds },
      },
      tx
    );
    return { eligible: eligibleIds.length };
  });

  // Emails go out after the motion is committed; a send failure never undoes the vote window.
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  let emailed = 0;
  if (closesAt && recipients.length > 0) {
    const results = await Promise.allSettled(
      recipients.map((r) =>
        sendBoardVoteRequestEmail({ to: r.email, recipientName: r.name, motionTitle: title, closesAt: closesAt!, voteUrl: `${base}/board/votes/${id}` })
      )
    );
    emailed = results.filter((r) => r.status === "fulfilled").length;
    for (const r of results) if (r.status === "rejected") console.error("[board vote email] failed", r.reason);
  }
  return { eligible: out.eligible, emailed };
}

type Outcome = { ok: true; status: MotionStatus } | { ok: false; code: "INVALID" | "FORBIDDEN"; message: string };

export async function castVote(ctx: SessionContext, motionId: string, choiceInput: unknown): Promise<{ choice: VoteChoice; motionStatus: MotionStatus }> {
  parseId(motionId);
  const choice = parseInput(voteChoiceSchema, choiceInput);
  const out = await db.transaction(async (tx): Promise<Outcome> => {
    const m = await lockMotion(tx, motionId);
    const now = new Date();
    const seat = await getMySeat(ctx, now, tx);
    if (!seat || seat.userId !== ctx.userId || !m.eligibleBoardMemberIds.includes(seat.id)) {
      throw new DalError("FORBIDDEN", "You are not an eligible voter on this motion.");
    }
    if (m.status !== "open") return { ok: false, code: "INVALID", message: "Voting is not open on this motion." };
    if (m.closesAt && m.closesAt <= now) {
      await finalizeMotion(tx, m, "deadline", null, now); // lazy close; commit it even though the vote is refused
      return { ok: false, code: "INVALID", message: "Voting on this motion has closed." };
    }
    if (m.kind === "in_meeting") {
      const present = m.meetingId ? await presentSeatIds(tx, m.meetingId, [seat.id]) : [];
      if (present.length === 0) {
        return { ok: false, code: "FORBIDDEN", message: "Only directors recorded as present or remote can vote on a motion made in a meeting." };
      }
    }
    const inserted = await tx
      .insert(boardVotes)
      .values({ motionId, boardMemberId: seat.id, userId: ctx.userId, choice, recordedByUserId: ctx.userId })
      .onConflictDoNothing()
      .returning({ id: boardVotes.id });
    if (inserted.length === 0) return { ok: false, code: "INVALID", message: "You have already voted on this motion. Votes are final." };
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_vote.cast", targetType: "board_vote", targetId: inserted[0].id, metadata: { motionId, boardMemberId: seat.id, choice, method: "self" } },
      tx
    );

    let status: MotionStatus = "open";
    if (m.kind === "without_meeting") {
      if (choice !== "yes") {
        status = (await finalizeMotion(tx, m, "early_fail", null, now)).status;
      } else {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(boardVotes)
          .where(and(eq(boardVotes.motionId, motionId), eq(boardVotes.choice, "yes")));
        if (n >= m.eligibleBoardMemberIds.length) status = (await finalizeMotion(tx, m, "early_pass", null, now)).status;
      }
    }
    return { ok: true, status };
  });
  if (!out.ok) throw new DalError(out.code, out.message);
  return { choice, motionStatus: out.status };
}

export async function recordRollCallVote(ctx: SessionContext, motionId: string, boardMemberId: string, choiceInput: unknown): Promise<void> {
  requireBoardModule(ctx);
  parseId(motionId);
  parseId(boardMemberId, "Seat");
  const choice = parseInput(voteChoiceSchema, choiceInput);
  const out = await db.transaction(async (tx): Promise<Outcome> => {
    const m = await lockMotion(tx, motionId);
    const now = new Date();
    if (m.kind !== "in_meeting") {
      return { ok: false, code: "INVALID", message: "Roll-call votes can only be recorded for motions made in a meeting." };
    }
    if (m.status !== "open") return { ok: false, code: "INVALID", message: "Voting is not open on this motion." };
    if (m.closesAt && m.closesAt <= now) {
      await finalizeMotion(tx, m, "deadline", null, now);
      return { ok: false, code: "INVALID", message: "Voting on this motion has closed." };
    }
    if (!m.eligibleBoardMemberIds.includes(boardMemberId)) {
      return { ok: false, code: "INVALID", message: "That director is not eligible to vote on this motion." };
    }
    const present = m.meetingId ? await presentSeatIds(tx, m.meetingId, [boardMemberId]) : [];
    if (present.length === 0) {
      return { ok: false, code: "INVALID", message: "Only directors recorded as present or remote can have a roll-call vote recorded." };
    }
    const [seat] = await tx.select({ userId: boardMembers.userId }).from(boardMembers).where(eq(boardMembers.id, boardMemberId)).limit(1);
    const inserted = await tx
      .insert(boardVotes)
      .values({ motionId, boardMemberId, userId: seat?.userId ?? null, choice, recordedByUserId: ctx.userId })
      .onConflictDoNothing()
      .returning({ id: boardVotes.id });
    if (inserted.length === 0) return { ok: false, code: "INVALID", message: "A vote is already recorded for that director. Votes are final." };
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_vote.cast", targetType: "board_vote", targetId: inserted[0].id, metadata: { motionId, boardMemberId, choice, method: "roll_call" } },
      tx
    );
    return { ok: true, status: "open" };
  });
  if (!out.ok) throw new DalError(out.code, out.message);
}

export async function closeMotion(ctx: SessionContext, id: string): Promise<{ status: "passed" | "failed"; result: MotionResult }> {
  requireBoardModule(ctx);
  parseId(id);
  return db.transaction(async (tx) => {
    const m = await lockMotion(tx, id);
    if (m.status !== "open") throw new DalError("INVALID", "Only an open motion can be closed.");
    return finalizeMotion(tx, m, "manual", ctx.userId, new Date());
  });
}

export async function withdrawMotion(ctx: SessionContext, id: string, reason?: string | null): Promise<void> {
  requireBoardModule(ctx);
  parseId(id);
  const note = parseInput(reasonSchema, reason);
  await db.transaction(async (tx) => {
    const m = await lockMotion(tx, id);
    if (m.status !== "draft" && m.status !== "open") throw new DalError("INVALID", "Only a draft or open motion can be withdrawn.");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(boardVotes).where(eq(boardVotes.motionId, id));
    if (n > 0) throw new DalError("INVALID", "A motion that has votes cannot be withdrawn. Close it instead.");
    await tx.update(boardMotions).set({ status: "withdrawn", closedAt: new Date() }).where(eq(boardMotions.id, id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "board_motion.withdrawn", targetType: "board_motion", targetId: id, metadata: { wasStatus: m.status, reason: note } },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Board reads
// ---------------------------------------------------------------------------

export interface MotionListRow {
  id: string;
  title: string;
  kind: MotionKind;
  threshold: MotionThreshold;
  status: MotionStatus;
  meetingId: string | null;
  meetingTitle: string | null;
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  votesCast: number;
  eligibleCount: number;
}

export async function listMotions(
  ctx: SessionContext,
  filter: { status?: MotionStatus; kind?: MotionKind; meetingId?: string } = {}
): Promise<MotionListRow[]> {
  requireBoardModule(ctx);
  await closeExpired();
  const rows = await db
    .select({
      id: boardMotions.id,
      title: boardMotions.title,
      kind: boardMotions.kind,
      threshold: boardMotions.threshold,
      status: boardMotions.status,
      meetingId: boardMotions.meetingId,
      meetingTitle: boardMeetings.title,
      openedAt: boardMotions.openedAt,
      closesAt: boardMotions.closesAt,
      closedAt: boardMotions.closedAt,
      createdAt: boardMotions.createdAt,
      eligible: boardMotions.eligibleBoardMemberIds,
      votesCast: sql<number>`(select count(*)::int from board_votes v where v.motion_id = ${boardMotions.id})`,
    })
    .from(boardMotions)
    .leftJoin(boardMeetings, eq(boardMeetings.id, boardMotions.meetingId))
    .where(
      and(
        filter.status ? eq(boardMotions.status, filter.status) : undefined,
        filter.kind ? eq(boardMotions.kind, filter.kind) : undefined,
        filter.meetingId && uuidRe.test(filter.meetingId) ? eq(boardMotions.meetingId, filter.meetingId) : undefined
      )
    )
    .orderBy(desc(boardMotions.createdAt));
  return rows.map(({ eligible, ...r }) => ({ ...r, eligibleCount: eligible.length }));
}

export interface MotionSeatRow {
  boardMemberId: string;
  displayName: string;
  position: string;
  hasAccount: boolean;
  attendance: "present" | "remote" | "absent" | "excused" | null;
  vote: { choice: VoteChoice; castAt: Date; recordedByName: string | null; recordedBySelf: boolean } | null;
}

export interface MotionDetail {
  id: string;
  kind: MotionKind;
  title: string;
  body: string;
  threshold: MotionThreshold;
  status: MotionStatus;
  quorumRequired: number | null;
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  result: MotionResult | null;
  meeting: { id: string; title: string; startsAt: Date; status: "scheduled" | "held" | "cancelled" } | null;
  movedBy: { id: string; name: string } | null;
  secondedBy: { id: string; name: string } | null;
  createdByName: string | null;
  /** Snapshotted seats once opened; for a draft, the seats that would be eligible right now (preview). */
  seats: MotionSeatRow[];
  seatsArePreview: boolean;
  tally: { yes: number; no: number; abstain: number; cast: number; voted: number; eligible: number; present: number | null };
}

export async function getMotion(ctx: SessionContext, id: string): Promise<MotionDetail> {
  requireBoardModule(ctx);
  parseId(id);
  await closeExpired(id);
  const [m] = await db.select().from(boardMotions).where(eq(boardMotions.id, id)).limit(1);
  if (!m) throw new DalError("NOT_FOUND", "Motion not found.");

  const preview = m.status === "draft";
  const seatRows = preview ? await listSeatedDirectors() : null;
  const seatIds = preview ? seatRows!.map((s) => s.id) : m.eligibleBoardMemberIds;
  const memberIds = [...new Set([...seatIds, m.movedByBoardMemberId, m.secondedByBoardMemberId].filter((x): x is string => !!x))];

  const members = memberIds.length
    ? await db.select().from(boardMembers).where(inArray(boardMembers.id, memberIds))
    : [];
  const memberById = new Map(members.map((s) => [s.id, s]));

  const recorder = alias(users, "recorder");
  const voteRows = await db
    .select({
      boardMemberId: boardVotes.boardMemberId,
      choice: boardVotes.choice,
      castAt: boardVotes.castAt,
      recordedByUserId: boardVotes.recordedByUserId,
      userId: boardVotes.userId,
      recordedByName: recorder.name,
    })
    .from(boardVotes)
    .leftJoin(recorder, eq(recorder.id, boardVotes.recordedByUserId))
    .where(eq(boardVotes.motionId, id));
  const voteBySeat = new Map(voteRows.map((v) => [v.boardMemberId, v]));

  const attendance = m.meetingId
    ? await db
        .select({ id: boardMeetingAttendance.boardMemberId, status: boardMeetingAttendance.status })
        .from(boardMeetingAttendance)
        .where(eq(boardMeetingAttendance.meetingId, m.meetingId))
    : [];
  const attBySeat = new Map(attendance.map((a) => [a.id, a.status]));

  const [meeting] = m.meetingId
    ? await db
        .select({ id: boardMeetings.id, title: boardMeetings.title, startsAt: boardMeetings.startsAt, status: boardMeetings.status })
        .from(boardMeetings)
        .where(eq(boardMeetings.id, m.meetingId))
        .limit(1)
    : [];

  const [creator] = m.createdByUserId ? await db.select({ name: users.name }).from(users).where(eq(users.id, m.createdByUserId)).limit(1) : [];

  const seats: MotionSeatRow[] = seatIds.map((sid) => {
    const s = memberById.get(sid);
    const v = voteBySeat.get(sid);
    return {
      boardMemberId: sid,
      displayName: s?.displayName ?? "Unknown seat",
      position: s?.position ?? "",
      hasAccount: !!s?.userId,
      attendance: attBySeat.get(sid) ?? null,
      vote: v
        ? { choice: v.choice, castAt: v.castAt, recordedByName: v.recordedByName, recordedBySelf: v.recordedByUserId === v.userId }
        : null,
    };
  });
  seats.sort((a, b) => a.position.localeCompare(b.position) || a.displayName.localeCompare(b.displayName));

  const yes = seats.filter((s) => s.vote?.choice === "yes").length;
  const no = seats.filter((s) => s.vote?.choice === "no").length;
  const abstain = seats.filter((s) => s.vote?.choice === "abstain").length;
  const present = m.kind === "in_meeting" ? seats.filter((s) => s.attendance === "present" || s.attendance === "remote").length : null;

  return {
    id: m.id,
    kind: m.kind,
    title: m.title,
    body: m.body,
    threshold: m.threshold,
    status: m.status,
    quorumRequired: m.quorumRequired,
    openedAt: m.openedAt,
    closesAt: m.closesAt,
    closedAt: m.closedAt,
    createdAt: m.createdAt,
    result: (m.result as MotionResult | null) ?? null,
    meeting: meeting ?? null,
    movedBy: m.movedByBoardMemberId ? { id: m.movedByBoardMemberId, name: memberById.get(m.movedByBoardMemberId)?.displayName ?? "Unknown" } : null,
    secondedBy: m.secondedByBoardMemberId ? { id: m.secondedByBoardMemberId, name: memberById.get(m.secondedByBoardMemberId)?.displayName ?? "Unknown" } : null,
    createdByName: creator?.name ?? null,
    seats,
    seatsArePreview: preview,
    tally: { yes, no, abstain, cast: yes + no, voted: yes + no + abstain, eligible: seats.length, present },
  };
}

export interface MotionFormOptions {
  meetings: { id: string; title: string; startsAt: Date; status: "scheduled" | "held" | "cancelled" }[];
  seats: { id: string; displayName: string; position: string }[];
}

/** Choices for the motion form: non-cancelled meetings (newest first) and currently seated directors. */
export async function listMotionFormOptions(ctx: SessionContext): Promise<MotionFormOptions> {
  requireBoardModule(ctx);
  const meetings = await db
    .select({ id: boardMeetings.id, title: boardMeetings.title, startsAt: boardMeetings.startsAt, status: boardMeetings.status })
    .from(boardMeetings)
    .where(ne(boardMeetings.status, "cancelled"))
    .orderBy(desc(boardMeetings.startsAt))
    .limit(60);
  const seats = (await listSeatedDirectors()).map((s) => ({ id: s.id, displayName: s.displayName, position: s.position }));
  return { meetings, seats };
}

// ---------------------------------------------------------------------------
// Director (voter) reads: any seated director with a linked account, regardless of org role
// ---------------------------------------------------------------------------

export interface MyMotionRow {
  id: string;
  title: string;
  body: string;
  kind: MotionKind;
  threshold: MotionThreshold;
  status: MotionStatus;
  meetingTitle: string | null;
  openedAt: Date | null;
  closesAt: Date | null;
  closedAt: Date | null;
  myVote: { choice: VoteChoice; castAt: Date } | null;
  canVote: boolean;
  cannotVoteReason: string | null;
  /** Closed motions only. */
  result: Pick<MotionResult, "yes" | "no" | "abstain" | "cast" | "eligible" | "passed" | "reason"> | null;
}

export async function getMyVotingSeat(ctx: SessionContext): Promise<{ id: string; displayName: string; position: string } | null> {
  const seat = await getMySeat(ctx);
  if (!seat || seat.userId !== ctx.userId) return null;
  return { id: seat.id, displayName: seat.displayName, position: seat.position };
}

async function loadMyMotions(ctx: SessionContext, onlyId?: string): Promise<MyMotionRow[]> {
  const seat = await getMyVotingSeat(ctx);
  if (!seat) throw new DalError("NOT_FOUND", "Page not found.");
  await closeExpired(onlyId);
  const now = new Date();
  const rows = await db
    .select({
      m: boardMotions,
      meetingTitle: boardMeetings.title,
      voteChoice: boardVotes.choice,
      voteAt: boardVotes.castAt,
    })
    .from(boardMotions)
    .leftJoin(boardMeetings, eq(boardMeetings.id, boardMotions.meetingId))
    .leftJoin(boardVotes, and(eq(boardVotes.motionId, boardMotions.id), eq(boardVotes.boardMemberId, seat.id)))
    .where(
      and(
        sql`${boardMotions.eligibleBoardMemberIds} @> ${JSON.stringify([seat.id])}::jsonb`,
        inArray(boardMotions.status, ["open", "passed", "failed"]),
        onlyId ? eq(boardMotions.id, onlyId) : undefined
      )
    )
    .orderBy(desc(boardMotions.openedAt))
    .limit(onlyId ? 1 : 60);

  const meetingIds = [...new Set(rows.filter((r) => r.m.kind === "in_meeting" && r.m.meetingId).map((r) => r.m.meetingId!))];
  const att = meetingIds.length
    ? await db
        .select({ meetingId: boardMeetingAttendance.meetingId, status: boardMeetingAttendance.status })
        .from(boardMeetingAttendance)
        .where(and(inArray(boardMeetingAttendance.meetingId, meetingIds), eq(boardMeetingAttendance.boardMemberId, seat.id)))
    : [];
  const presentAt = new Set(att.filter((a) => a.status === "present" || a.status === "remote").map((a) => a.meetingId));

  return rows.map(({ m, meetingTitle, voteChoice, voteAt }) => {
    const open = m.status === "open" && !(m.closesAt && m.closesAt <= now);
    let canVote = open && !voteChoice;
    let cannotVoteReason: string | null = null;
    if (open && !voteChoice && m.kind === "in_meeting" && !(m.meetingId && presentAt.has(m.meetingId))) {
      canVote = false;
      cannotVoteReason = "You are not recorded as present or remote for this meeting.";
    }
    const r = m.result as MotionResult | null;
    return {
      id: m.id,
      title: m.title,
      body: m.body,
      kind: m.kind,
      threshold: m.threshold,
      status: m.status,
      meetingTitle,
      openedAt: m.openedAt,
      closesAt: m.closesAt,
      closedAt: m.closedAt,
      myVote: voteChoice && voteAt ? { choice: voteChoice, castAt: voteAt } : null,
      canVote,
      cannotVoteReason,
      result:
        r && m.status !== "open"
          ? { yes: r.yes, no: r.no, abstain: r.abstain, cast: r.cast, eligible: r.eligible, passed: r.passed, reason: r.reason }
          : null,
    };
  });
}

/** Motions where my seat is in the eligible snapshot (open first, then recent closed). 404 if I'm not a seated director. */
export async function listMyMotions(ctx: SessionContext): Promise<MyMotionRow[]> {
  const rows = await loadMyMotions(ctx);
  return rows.sort((a, b) => Number(b.status === "open") - Number(a.status === "open"));
}

export async function getMyMotion(ctx: SessionContext, id: string): Promise<MyMotionRow> {
  parseId(id);
  const [row] = await loadMyMotions(ctx, id);
  if (!row) throw new DalError("NOT_FOUND", "Motion not found.");
  return row;
}
