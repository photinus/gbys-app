import "server-only";
import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { boardMeetingAttendance, boardMembers, boardVotes, orgSettings, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import {
  DEFAULT_BOARD_POSITIONS,
  boardIdSchema,
  comparePositions,
  positionListSchema,
  samePosition,
  endSeatSchema,
  listMembersSchema,
  memberInputSchema,
  seatTermStatus,
  type EndSeatInput,
  type MemberInput,
  type SeatTermStatus,
} from "@/lib/validation/board";
import { requireBoardModule } from "./board-shared";
import { DalError, type OrgRole, type SessionContext } from "./context";

export interface SeatWarning {
  kind: "no_account" | "not_board_role" | "account_deactivated" | "duplicate_position";
  message: string;
  /** Where the board can fix it (admin user page). */
  href?: string;
}

export interface BoardMemberView {
  id: string;
  userId: string | null;
  displayName: string;
  position: string;
  isVotingDirector: boolean;
  termStart: string;
  termEnd: string | null;
  electedOn: string | null;
  endedAt: Date | null;
  endReason: string | null;
  notes: string | null;
  account: { email: string; name: string; orgRole: OrgRole; isActive: boolean } | null;
  status: SeatTermStatus;
  /** Whole days until the last term day; only for current seats with a term end. */
  daysLeft: number | null;
  /** True when attendance or votes reference this seat (history is locked). */
  hasHistory: boolean;
  warnings: SeatWarning[];
}

function seatWarnings(
  seat: { isVotingDirector: boolean; userId: string | null },
  account: BoardMemberView["account"]
): SeatWarning[] {
  const out: SeatWarning[] = [];
  if (!seat.userId || !account) {
    if (seat.isVotingDirector) {
      out.push({
        kind: "no_account",
        message: "No linked account, so this director can't vote electronically. Link their GBYS sign-in email by editing the seat.",
      });
    }
    return out;
  }
  if (!account.isActive) {
    out.push({ kind: "account_deactivated", message: "This director's account is deactivated, so they can't sign in or vote.", href: `/admin/users/${seat.userId}` });
  }
  if (account.orgRole === "member") {
    out.push({
      kind: "not_board_role",
      message: "Their account doesn't have board access yet, so they can't manage this module. Grant access on their user page.",
      href: `/admin/users/${seat.userId}`,
    });
  }
  return out;
}

async function getBoardPositionsRaw(tx: DbOrTx): Promise<string[]> {
  const [row] = await tx.select({ p: orgSettings.boardPositions }).from(orgSettings).where(eq(orgSettings.id, 1)).limit(1);
  return Array.isArray(row?.p) ? row.p : [...DEFAULT_BOARD_POSITIONS];
}

/** Configured seat titles in display order. Board-only. Falls back to the defaults if unset. */
export async function getBoardPositions(ctx: SessionContext): Promise<string[]> {
  requireBoardModule(ctx);
  return getBoardPositionsRaw(db);
}

/** Replace the position list. Existing seats keep their stored titles. No-op = no audit. */
export async function updateBoardPositions(ctx: SessionContext, positions: string[]): Promise<{ positions: string[]; changed: boolean }> {
  requireBoardModule(ctx);
  const next = positionListSchema.parse(positions);
  return db.transaction(async (tx) => {
    await tx.insert(orgSettings).values({ id: 1 }).onConflictDoNothing();
    const [old] = await tx.select({ p: orgSettings.boardPositions }).from(orgSettings).where(eq(orgSettings.id, 1)).for("update").limit(1);
    const from: string[] = Array.isArray(old?.p) ? old.p : [...DEFAULT_BOARD_POSITIONS];
    if (from.length === next.length && from.every((p, i) => p === next[i])) return { positions: next, changed: false };
    await tx.update(orgSettings).set({ boardPositions: next, updatedByUserId: ctx.userId }).where(eq(orgSettings.id, 1));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "settings.updated",
        targetType: "org_settings",
        targetId: "1",
        metadata: { field: "boardPositions", from, to: next },
      },
      tx
    );
    return { positions: next, changed: true };
  });
}

/** Warn (never block) when another current seat already holds this title. The last configured title (Director) is expected to repeat. */
async function duplicatePositionWarning(tx: DbOrTx, position: string, excludeId: string | null, now: Date): Promise<SeatWarning[]> {
  const list = await getBoardPositionsRaw(tx);
  if (list.length && samePosition(list[list.length - 1], position)) return [];
  const today = utcToLaDateInput(now);
  const rows = await tx.select().from(boardMembers).where(sql`lower(${boardMembers.position}) = ${position.trim().toLowerCase()}`);
  const other = rows.find((r) => r.id !== excludeId && seatTermStatus(r, today, now).status === "current");
  if (!other) return [];
  return [{ kind: "duplicate_position", message: `${other.displayName} also holds the position "${other.position}". That's allowed, but check this is intended.` }];
}

/** Board members (seats). Current = not ended and the term hasn't run out (upcoming seats included). */
export async function listBoardMembers(
  ctx: SessionContext,
  opts: { include?: "current" | "all" } = {},
  now: Date = new Date()
): Promise<BoardMemberView[]> {
  requireBoardModule(ctx);
  const { include } = listMembersSchema.parse(opts);
  const today = utcToLaDateInput(now);
  const positionOrder = await getBoardPositionsRaw(db);

  const rows = await db
    .select({
      seat: boardMembers,
      email: users.email,
      userName: users.name,
      orgRole: users.orgRole,
      deletedAt: users.deletedAt,
      hasHistory: sql<boolean>`(
        exists (select 1 from ${boardMeetingAttendance} a where a.board_member_id = ${boardMembers.id})
        or exists (select 1 from ${boardVotes} v where v.board_member_id = ${boardMembers.id})
      )`,
    })
    .from(boardMembers)
    .leftJoin(users, eq(users.id, boardMembers.userId))
    .orderBy(asc(boardMembers.displayName));

  const order: Record<SeatTermStatus, number> = { current: 0, upcoming: 1, ended: 2 };
  const views = rows.map((r): BoardMemberView => {
    const account = r.email
      ? { email: r.email, name: r.userName ?? r.email, orgRole: r.orgRole as OrgRole, isActive: !r.deletedAt }
      : null;
    const { status, daysLeft } = seatTermStatus(r.seat, today, now);
    return {
      id: r.seat.id,
      userId: r.seat.userId,
      displayName: r.seat.displayName,
      position: r.seat.position,
      isVotingDirector: r.seat.isVotingDirector,
      termStart: r.seat.termStart,
      termEnd: r.seat.termEnd,
      electedOn: r.seat.electedOn,
      endedAt: r.seat.endedAt,
      endReason: r.seat.endReason,
      notes: r.seat.notes,
      account,
      status,
      daysLeft,
      hasHistory: !!r.hasHistory,
      warnings: status === "ended" ? [] : seatWarnings(r.seat, account),
    };
  });
  return views
    .filter((v) => include === "all" || v.status !== "ended")
    .sort((a, b) => order[a.status] - order[b.status] || comparePositions(a.position, b.position, positionOrder) || a.displayName.localeCompare(b.displayName));
}

async function resolveUserByEmail(email: string | null, tx: DbOrTx): Promise<string | null> {
  if (!email) return null;
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)))
    .limit(1);
  if (!u) {
    throw new DalError(
      "INVALID",
      "No GBYS account uses that email yet. Ask them to sign in once, or leave the email blank and link it later."
    );
  }
  return u.id;
}

/** One person may not hold two overlapping, unended voting seats (one person, one vote). */
async function assertNoOverlappingVotingSeat(
  tx: DbOrTx,
  v: { userId: string | null; isVotingDirector: boolean; termStart: string; termEnd: string | null },
  now: Date,
  excludeId?: string
) {
  if (!v.userId || !v.isVotingDirector) return;
  const conds = [
    eq(boardMembers.userId, v.userId),
    eq(boardMembers.isVotingDirector, true),
    or(isNull(boardMembers.endedAt), gt(boardMembers.endedAt, now)),
    or(isNull(boardMembers.termEnd), sql`${boardMembers.termEnd} >= ${v.termStart}`),
    v.termEnd ? sql`${boardMembers.termStart} <= ${v.termEnd}` : undefined,
    excludeId ? ne(boardMembers.id, excludeId) : undefined,
  ];
  const [clash] = await tx.select({ id: boardMembers.id, position: boardMembers.position }).from(boardMembers).where(and(...conds)).limit(1);
  if (clash) {
    throw new DalError("INVALID", `That account already holds a voting seat (${clash.position}) in an overlapping term. End it first, or make this seat non-voting.`);
  }
}

export async function addBoardMember(
  ctx: SessionContext,
  input: MemberInput,
  now: Date = new Date()
): Promise<{ id: string; warnings: SeatWarning[] }> {
  requireBoardModule(ctx);
  const v = memberInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const userId = await resolveUserByEmail(v.email, tx);
    await assertNoOverlappingVotingSeat(tx, { ...v, userId }, now);
    const [seat] = await tx
      .insert(boardMembers)
      .values({
        userId,
        displayName: v.displayName,
        position: v.position,
        isVotingDirector: v.isVotingDirector,
        termStart: v.termStart,
        termEnd: v.termEnd,
        electedOn: v.electedOn,
        notes: v.notes,
        createdByUserId: ctx.userId,
      })
      .returning({ id: boardMembers.id });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "board_member.added",
        targetType: "board_member",
        targetId: seat.id,
        metadata: { displayName: v.displayName, position: v.position, isVotingDirector: v.isVotingDirector, termStart: v.termStart, termEnd: v.termEnd, linkedUserId: userId },
      },
      tx
    );
    let account: BoardMemberView["account"] = null;
    if (userId) {
      const [u] = await tx.select({ email: users.email, name: users.name, orgRole: users.orgRole, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId));
      account = { email: u.email, name: u.name, orgRole: u.orgRole as OrgRole, isActive: !u.deletedAt };
    }
    const dup = await duplicatePositionWarning(tx, v.position, seat.id, now);
    return { id: seat.id, warnings: [...seatWarnings({ isVotingDirector: v.isVotingDirector, userId }, account), ...dup] };
  });
}

export async function updateBoardMember(
  ctx: SessionContext,
  id: string,
  input: MemberInput,
  now: Date = new Date()
): Promise<{ warnings: SeatWarning[] }> {
  requireBoardModule(ctx);
  const seatId = boardIdSchema.parse(id);
  const v = memberInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const [seat] = await tx.select().from(boardMembers).where(eq(boardMembers.id, seatId)).for("update");
    if (!seat) throw new DalError("NOT_FOUND", "Seat not found.");
    const userId = await resolveUserByEmail(v.email, tx);

    const ended = seatTermStatus(seat, utcToLaDateInput(now), now).status === "ended";
    const [att] = await tx.select({ id: boardMeetingAttendance.id }).from(boardMeetingAttendance).where(eq(boardMeetingAttendance.boardMemberId, seatId)).limit(1);
    const [vote] = await tx.select({ id: boardVotes.id }).from(boardVotes).where(eq(boardVotes.boardMemberId, seatId)).limit(1);
    const hasHistory = !!att || !!vote;
    const lockedChanged =
      userId !== seat.userId || v.isVotingDirector !== seat.isVotingDirector || v.termStart !== seat.termStart || (ended && v.termEnd !== seat.termEnd);
    if (lockedChanged && (ended || hasHistory)) {
      throw new DalError(
        "INVALID",
        ended
          ? "This seat has ended. Only the name, position and notes can change."
          : "This seat already has attendance or votes recorded. End it and add a new seat instead of changing the account, voting right or term start."
      );
    }
    if (!ended) await assertNoOverlappingVotingSeat(tx, { ...v, userId }, now, seatId);

    await tx
      .update(boardMembers)
      .set({
        userId,
        displayName: v.displayName,
        position: v.position,
        isVotingDirector: v.isVotingDirector,
        termStart: v.termStart,
        termEnd: v.termEnd,
        electedOn: v.electedOn,
        notes: v.notes,
      })
      .where(eq(boardMembers.id, seatId));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "board_member.updated",
        targetType: "board_member",
        targetId: seatId,
        metadata: { before: { position: seat.position, isVotingDirector: seat.isVotingDirector, termStart: seat.termStart, termEnd: seat.termEnd, userId: seat.userId }, after: { position: v.position, isVotingDirector: v.isVotingDirector, termStart: v.termStart, termEnd: v.termEnd, userId } },
      },
      tx
    );
    let account: BoardMemberView["account"] = null;
    if (userId) {
      const [u] = await tx.select({ email: users.email, name: users.name, orgRole: users.orgRole, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId));
      account = { email: u.email, name: u.name, orgRole: u.orgRole as OrgRole, isActive: !u.deletedAt };
    }
    const dup = ended ? [] : await duplicatePositionWarning(tx, v.position, seatId, now);
    return { warnings: ended ? [] : [...seatWarnings({ isVotingDirector: v.isVotingDirector, userId }, account), ...dup] };
  });
}

/**
 * Early end of a seat (resignation / removal). Seats are never deleted. Today's date
 * ends the seat immediately; any other date ends it at the end of that Pacific day.
 */
export async function endBoardMember(ctx: SessionContext, id: string, input: EndSeatInput, now: Date = new Date()): Promise<void> {
  requireBoardModule(ctx);
  const seatId = boardIdSchema.parse(id);
  const v = endSeatSchema.parse(input);
  await db.transaction(async (tx) => {
    const [seat] = await tx.select().from(boardMembers).where(eq(boardMembers.id, seatId)).for("update");
    if (!seat) throw new DalError("NOT_FOUND", "Seat not found.");
    if (seat.endedAt) throw new DalError("INVALID", "This seat has already ended.");
    if (v.endedAt < seat.termStart) throw new DalError("INVALID", "The end date can't be before the term started.");
    const endedAt = v.endedAt === utcToLaDateInput(now) ? now : laDateInputToUtc(v.endedAt, true);
    await tx.update(boardMembers).set({ endedAt, endReason: v.reason }).where(eq(boardMembers.id, seatId));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "board_member.ended",
        targetType: "board_member",
        targetId: seatId,
        metadata: { displayName: seat.displayName, position: seat.position, endedAt: endedAt.toISOString(), reason: v.reason },
      },
      tx
    );
  });
}
