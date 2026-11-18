import "server-only";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbTx } from "@/db";
import {
  programs,
  users,
  volunteerLogs,
  volunteerShiftSignups,
  volunteerShifts,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { currentInKindRateCents } from "@/lib/grant-rate";
import {
  shiftSchema,
  undoReasonSchema,
  uuidSchema,
  walkInEmailSchema,
  type ShiftFormInput,
} from "@/lib/validation/shifts";
import type { VolunteerCategory } from "@/lib/volunteer-categories";
import { DalError, isBoard, type SessionContext } from "./context";
import { canCheckIn, canManageShifts, checkInProgramIds } from "./permissions";

const HOUR_MS = 60 * 60 * 1000;
const CHECK_IN_EARLY_MS = 2 * HOUR_MS;
const CHECK_IN_LATE_MS = 7 * 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type MyShiftStatus = "signed_up" | "checked_in" | null;

export interface ShiftListItem {
  id: string;
  programId: string | null;
  programName: string | null;
  title: string;
  description: string | null;
  location: string | null;
  category: VolunteerCategory;
  startsAt: Date;
  endsAt: Date;
  spotsTotal: number;
  spotsFilled: number;
  mySignupId: string | null;
  myStatus: MyShiftStatus;
  /** Sign-ups close when the shift starts. */
  signupOpen: boolean;
}

export interface MyShiftItem {
  signupId: string;
  shiftId: string;
  title: string;
  programName: string | null;
  location: string | null;
  category: VolunteerCategory;
  startsAt: Date;
  endsAt: Date;
  shiftCancelled: boolean;
  checkedInAt: Date | null;
  /** Upcoming, not cancelled, not checked in: the volunteer may still cancel. */
  canCancel: boolean;
  isUpcoming: boolean;
}

export interface ManageShiftItem {
  id: string;
  programId: string | null;
  programName: string | null;
  title: string;
  description: string | null;
  location: string | null;
  category: VolunteerCategory;
  startsAt: Date;
  endsAt: Date;
  spotsTotal: number;
  spotsFilled: number;
  checkedInCount: number;
  cancelledAt: Date | null;
  /** May edit / cancel (board or program_admin). Everyone listed may open the roster. */
  canManage: boolean;
}

export interface RosterShift {
  id: string;
  programId: string | null;
  programName: string | null;
  title: string;
  description: string | null;
  location: string | null;
  category: VolunteerCategory;
  startsAt: Date;
  endsAt: Date;
  spotsTotal: number;
  cancelledAt: Date | null;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  checkInOpen: boolean;
}

export interface RosterEntry {
  signupId: string;
  userId: string;
  name: string;
  email: string;
  signedUpAt: Date;
  checkedInAt: Date | null;
  checkedInByName: string | null;
  loggedMinutes: number | null;
}

export interface ShiftRoster {
  shift: RosterShift;
  entries: RosterEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function assertUuid(id: string, what = "Shift"): void {
  if (!uuidSchema.safeParse(id).success) throw new DalError("NOT_FOUND", `${what} not found.`);
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}

function checkInWindow(shift: { startsAt: Date; endsAt: Date }, now: Date) {
  const opensAt = new Date(shift.startsAt.getTime() - CHECK_IN_EARLY_MS);
  const closesAt = new Date(shift.endsAt.getTime() + CHECK_IN_LATE_MS);
  return { opensAt, closesAt, open: now >= opensAt && now <= closesAt };
}

/** Scalar subquery: live (not cancelled) sign-ups of the outer shift row. */
const liveSignupCount = sql<number>`(select count(*)::int from ${volunteerShiftSignups} s where s.shift_id = ${volunteerShifts.id} and s.cancelled_at is null)`;

async function assertActiveProgram(programId: string): Promise<void> {
  const [p] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.isActive, true), isNull(programs.deletedAt)))
    .limit(1);
  if (!p) throw new DalError("INVALID", "Choose an active program.");
}

// ---------------------------------------------------------------------------
// Member: browse, sign up, cancel
// ---------------------------------------------------------------------------
/** Open (not cancelled) shifts that have not ended, soonest first. Any signed-in user. */
export async function listUpcomingShifts(
  ctx: SessionContext,
  opts: { programId?: string | null; includePast?: boolean } = {}
): Promise<ShiftListItem[]> {
  const now = new Date();
  const conds = [isNull(volunteerShifts.cancelledAt)];
  if (!opts.includePast) conds.push(gt(volunteerShifts.endsAt, now));
  if (opts.programId) {
    if (!uuidSchema.safeParse(opts.programId).success) return [];
    conds.push(eq(volunteerShifts.programId, opts.programId));
  }
  const rows = await db
    .select({
      id: volunteerShifts.id,
      programId: volunteerShifts.programId,
      programName: programs.name,
      title: volunteerShifts.title,
      description: volunteerShifts.description,
      location: volunteerShifts.location,
      category: volunteerShifts.category,
      startsAt: volunteerShifts.startsAt,
      endsAt: volunteerShifts.endsAt,
      spotsTotal: volunteerShifts.spotsTotal,
      spotsFilled: liveSignupCount,
      mySignupId: volunteerShiftSignups.id,
      mySignupCancelledAt: volunteerShiftSignups.cancelledAt,
      myCheckedInAt: volunteerShiftSignups.checkedInAt,
    })
    .from(volunteerShifts)
    .leftJoin(programs, eq(programs.id, volunteerShifts.programId))
    .leftJoin(
      volunteerShiftSignups,
      and(
        eq(volunteerShiftSignups.shiftId, volunteerShifts.id),
        eq(volunteerShiftSignups.userId, ctx.userId)
      )
    )
    .where(and(...conds))
    .orderBy(asc(volunteerShifts.startsAt), asc(volunteerShifts.id));

  return rows.map((r) => {
    const live = r.mySignupId && !r.mySignupCancelledAt;
    return {
      id: r.id,
      programId: r.programId,
      programName: r.programName,
      title: r.title,
      description: r.description,
      location: r.location,
      category: r.category,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      spotsTotal: r.spotsTotal,
      spotsFilled: r.spotsFilled,
      mySignupId: live ? r.mySignupId : null,
      myStatus: live ? (r.myCheckedInAt ? "checked_in" : "signed_up") : null,
      signupOpen: r.startsAt > now,
    };
  });
}

/** My live sign-ups: upcoming ones and those from the last 30 days. */
export async function listMyShifts(ctx: SessionContext): Promise<MyShiftItem[]> {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 24 * HOUR_MS);
  const rows = await db
    .select({
      signupId: volunteerShiftSignups.id,
      shiftId: volunteerShifts.id,
      title: volunteerShifts.title,
      programName: programs.name,
      location: volunteerShifts.location,
      category: volunteerShifts.category,
      startsAt: volunteerShifts.startsAt,
      endsAt: volunteerShifts.endsAt,
      shiftCancelledAt: volunteerShifts.cancelledAt,
      checkedInAt: volunteerShiftSignups.checkedInAt,
    })
    .from(volunteerShiftSignups)
    .innerJoin(volunteerShifts, eq(volunteerShifts.id, volunteerShiftSignups.shiftId))
    .leftJoin(programs, eq(programs.id, volunteerShifts.programId))
    .where(
      and(
        eq(volunteerShiftSignups.userId, ctx.userId),
        isNull(volunteerShiftSignups.cancelledAt),
        gte(volunteerShifts.endsAt, since)
      )
    )
    .orderBy(asc(volunteerShifts.startsAt), asc(volunteerShifts.id));

  return rows.map((r) => ({
    signupId: r.signupId,
    shiftId: r.shiftId,
    title: r.title,
    programName: r.programName,
    location: r.location,
    category: r.category,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    shiftCancelled: r.shiftCancelledAt !== null,
    checkedInAt: r.checkedInAt,
    canCancel: r.startsAt > now && !r.checkedInAt,
    isUpcoming: r.endsAt > now,
  }));
}

/**
 * Sign the current user up. The shift row is locked FOR UPDATE so the capacity
 * count and the insert are atomic with respect to other sign-ups.
 */
export async function signUpForShift(
  ctx: SessionContext,
  shiftId: string
): Promise<{ signupId: string }> {
  assertUuid(shiftId);
  return db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(volunteerShifts)
      .where(eq(volunteerShifts.id, shiftId))
      .for("update");
    if (!shift) throw new DalError("NOT_FOUND", "Shift not found.");
    if (shift.cancelledAt) throw new DalError("INVALID", "This shift was cancelled.");
    const now = new Date();
    if (shift.startsAt <= now) throw new DalError("INVALID", "This shift has already started.");

    const [existing] = await tx
      .select()
      .from(volunteerShiftSignups)
      .where(
        and(eq(volunteerShiftSignups.shiftId, shiftId), eq(volunteerShiftSignups.userId, ctx.userId))
      )
      .for("update");
    if (existing && !existing.cancelledAt) {
      throw new DalError("INVALID", "You are already signed up for this shift.");
    }

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(volunteerShiftSignups)
      .where(and(eq(volunteerShiftSignups.shiftId, shiftId), isNull(volunteerShiftSignups.cancelledAt)));
    if (n >= shift.spotsTotal) throw new DalError("INVALID", "This shift is full.");

    let signupId: string;
    if (existing) {
      await tx
        .update(volunteerShiftSignups)
        .set({
          cancelledAt: null,
          signedUpAt: now,
          checkedInAt: null,
          checkedInByUserId: null,
          volunteerLogId: null,
        })
        .where(eq(volunteerShiftSignups.id, existing.id));
      signupId = existing.id;
    } else {
      const [row] = await tx
        .insert(volunteerShiftSignups)
        .values({ shiftId, userId: ctx.userId })
        .returning({ id: volunteerShiftSignups.id });
      signupId = row.id;
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "shift.signed_up",
        targetType: "shift_signup",
        targetId: signupId,
        metadata: { shiftId },
      },
      tx
    );
    return { signupId };
  });
}

/** Cancel my own sign-up (before the start, and never after check-in). */
export async function cancelMySignup(ctx: SessionContext, signupId: string): Promise<void> {
  assertUuid(signupId, "Sign-up");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: volunteerShiftSignups.id,
        userId: volunteerShiftSignups.userId,
        shiftId: volunteerShiftSignups.shiftId,
        cancelledAt: volunteerShiftSignups.cancelledAt,
        checkedInAt: volunteerShiftSignups.checkedInAt,
        startsAt: volunteerShifts.startsAt,
      })
      .from(volunteerShiftSignups)
      .innerJoin(volunteerShifts, eq(volunteerShifts.id, volunteerShiftSignups.shiftId))
      .where(eq(volunteerShiftSignups.id, signupId))
      .for("update", { of: volunteerShiftSignups });
    if (!row || row.userId !== ctx.userId) throw new DalError("NOT_FOUND", "Sign-up not found.");
    if (row.cancelledAt) throw new DalError("INVALID", "This sign-up is already cancelled.");
    if (row.checkedInAt) throw new DalError("INVALID", "You are already checked in.");
    if (row.startsAt <= new Date()) {
      throw new DalError("INVALID", "This shift has already started. Contact a coordinator.");
    }
    await tx
      .update(volunteerShiftSignups)
      .set({ cancelledAt: new Date() })
      .where(eq(volunteerShiftSignups.id, signupId));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "shift.signup_cancelled",
        targetType: "shift_signup",
        targetId: signupId,
        metadata: { shiftId: row.shiftId },
      },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Coordinator: list / create / edit / cancel
// ---------------------------------------------------------------------------
export async function listManageableShifts(
  ctx: SessionContext,
  opts: { range: "upcoming" | "past" }
): Promise<ManageShiftItem[]> {
  const scope = checkInProgramIds(ctx);
  if (scope !== "all" && scope.length === 0) {
    throw new DalError("FORBIDDEN", "You do not have permission to manage shifts.");
  }
  const now = new Date();
  const conds = [opts.range === "upcoming" ? gt(volunteerShifts.endsAt, now) : lte(volunteerShifts.endsAt, now)];
  if (scope !== "all") conds.push(inArray(volunteerShifts.programId, scope));

  const rows = await db
    .select({
      id: volunteerShifts.id,
      programId: volunteerShifts.programId,
      programName: programs.name,
      title: volunteerShifts.title,
      description: volunteerShifts.description,
      location: volunteerShifts.location,
      category: volunteerShifts.category,
      startsAt: volunteerShifts.startsAt,
      endsAt: volunteerShifts.endsAt,
      spotsTotal: volunteerShifts.spotsTotal,
      spotsFilled: liveSignupCount,
      checkedInCount: sql<number>`(select count(*)::int from ${volunteerShiftSignups} s where s.shift_id = ${volunteerShifts.id} and s.cancelled_at is null and s.checked_in_at is not null)`,
      cancelledAt: volunteerShifts.cancelledAt,
    })
    .from(volunteerShifts)
    .leftJoin(programs, eq(programs.id, volunteerShifts.programId))
    .where(and(...conds))
    .orderBy(
      opts.range === "upcoming" ? asc(volunteerShifts.startsAt) : desc(volunteerShifts.startsAt),
      asc(volunteerShifts.id)
    )
    .limit(200);

  return rows.map((r) => ({ ...r, canManage: canManageShifts(ctx, r.programId) }));
}

export async function createShift(ctx: SessionContext, raw: ShiftFormInput): Promise<{ id: string }> {
  const input = shiftSchema.parse(raw);
  if (!canManageShifts(ctx, input.programId)) {
    throw new DalError("FORBIDDEN", "You do not have permission to create shifts for that program.");
  }
  if (input.programId) await assertActiveProgram(input.programId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(volunteerShifts)
      .values({
        programId: input.programId,
        title: input.title,
        description: input.description,
        location: input.location,
        category: input.category,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        spotsTotal: input.spotsTotal,
        createdByUserId: ctx.userId,
      })
      .returning({ id: volunteerShifts.id });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "shift.created",
        targetType: "volunteer_shift",
        targetId: row.id,
        metadata: {
          programId: input.programId,
          title: input.title,
          startsAt: input.startsAt.toISOString(),
          spotsTotal: input.spotsTotal,
        },
      },
      tx
    );
    return row;
  });
}

/**
 * Edit a shift. Spots cannot drop below live sign-ups. Once anyone is checked in,
 * the time, category and program are frozen (the ledger rows copied them): undo the
 * check-ins first.
 */
export async function updateShift(
  ctx: SessionContext,
  id: string,
  raw: ShiftFormInput
): Promise<void> {
  assertUuid(id);
  const input = shiftSchema.parse(raw);
  if (input.programId) await assertActiveProgram(input.programId);
  await db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(volunteerShifts)
      .where(eq(volunteerShifts.id, id))
      .for("update");
    if (!shift) throw new DalError("NOT_FOUND", "Shift not found.");
    if (!canManageShifts(ctx, shift.programId) || !canManageShifts(ctx, input.programId)) {
      throw new DalError("FORBIDDEN", "You do not have permission to edit this shift.");
    }
    if (shift.cancelledAt) throw new DalError("INVALID", "A cancelled shift cannot be edited.");

    const [{ live, checkedIn }] = await tx
      .select({
        live: sql<number>`count(*)::int`,
        checkedIn: sql<number>`(count(*) filter (where ${volunteerShiftSignups.checkedInAt} is not null))::int`,
      })
      .from(volunteerShiftSignups)
      .where(and(eq(volunteerShiftSignups.shiftId, id), isNull(volunteerShiftSignups.cancelledAt)));
    if (input.spotsTotal < live) {
      throw new DalError(
        "INVALID",
        `${live} volunteer${live === 1 ? " is" : "s are"} signed up. Spots cannot go below that.`
      );
    }
    const changedWindow =
      input.startsAt.getTime() !== shift.startsAt.getTime() ||
      input.endsAt.getTime() !== shift.endsAt.getTime() ||
      input.category !== shift.category ||
      input.programId !== shift.programId;
    if (checkedIn > 0 && changedWindow) {
      throw new DalError(
        "INVALID",
        "Volunteers are already checked in. Undo their check-ins before changing the time, category or program."
      );
    }

    const changed = (
      [
        ["programId", input.programId !== shift.programId],
        ["title", input.title !== shift.title],
        ["description", input.description !== shift.description],
        ["location", input.location !== shift.location],
        ["category", input.category !== shift.category],
        ["startsAt", input.startsAt.getTime() !== shift.startsAt.getTime()],
        ["endsAt", input.endsAt.getTime() !== shift.endsAt.getTime()],
        ["spotsTotal", input.spotsTotal !== shift.spotsTotal],
      ] as const
    )
      .filter(([, c]) => c)
      .map(([k]) => k);

    await tx
      .update(volunteerShifts)
      .set({
        programId: input.programId,
        title: input.title,
        description: input.description,
        location: input.location,
        category: input.category,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        spotsTotal: input.spotsTotal,
      })
      .where(eq(volunteerShifts.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "shift.updated",
        targetType: "volunteer_shift",
        targetId: id,
        metadata: { changed },
      },
      tx
    );
  });
}

/** Soft-cancel (cancelledAt). Existing ledger entries are untouched. */
export async function cancelShift(ctx: SessionContext, id: string): Promise<void> {
  assertUuid(id);
  await db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(volunteerShifts)
      .where(eq(volunteerShifts.id, id))
      .for("update");
    if (!shift) throw new DalError("NOT_FOUND", "Shift not found.");
    if (!canManageShifts(ctx, shift.programId)) {
      throw new DalError("FORBIDDEN", "You do not have permission to cancel this shift.");
    }
    if (shift.cancelledAt) throw new DalError("INVALID", "This shift is already cancelled.");
    await tx
      .update(volunteerShifts)
      .set({ cancelledAt: new Date() })
      .where(eq(volunteerShifts.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "shift.cancelled",
        targetType: "volunteer_shift",
        targetId: id,
        metadata: { title: shift.title },
      },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Kiosk roster and check-in
// ---------------------------------------------------------------------------
export async function getShiftRoster(ctx: SessionContext, shiftId: string): Promise<ShiftRoster> {
  assertUuid(shiftId);
  const [shift] = await db
    .select({
      id: volunteerShifts.id,
      programId: volunteerShifts.programId,
      programName: programs.name,
      title: volunteerShifts.title,
      description: volunteerShifts.description,
      location: volunteerShifts.location,
      category: volunteerShifts.category,
      startsAt: volunteerShifts.startsAt,
      endsAt: volunteerShifts.endsAt,
      spotsTotal: volunteerShifts.spotsTotal,
      cancelledAt: volunteerShifts.cancelledAt,
    })
    .from(volunteerShifts)
    .leftJoin(programs, eq(programs.id, volunteerShifts.programId))
    .where(eq(volunteerShifts.id, shiftId))
    .limit(1);
  if (!shift) throw new DalError("NOT_FOUND", "Shift not found.");
  if (!canCheckIn(ctx, shift.programId)) {
    throw new DalError("FORBIDDEN", "You do not have permission to open this roster.");
  }

  const checker = alias(users, "checker");
  const rows = await db
    .select({
      signupId: volunteerShiftSignups.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      signedUpAt: volunteerShiftSignups.signedUpAt,
      checkedInAt: volunteerShiftSignups.checkedInAt,
      checkedInByName: checker.name,
      loggedMinutes: volunteerLogs.durationMinutes,
    })
    .from(volunteerShiftSignups)
    .innerJoin(users, eq(users.id, volunteerShiftSignups.userId))
    .leftJoin(checker, eq(checker.id, volunteerShiftSignups.checkedInByUserId))
    .leftJoin(volunteerLogs, eq(volunteerLogs.id, volunteerShiftSignups.volunteerLogId))
    .where(and(eq(volunteerShiftSignups.shiftId, shiftId), isNull(volunteerShiftSignups.cancelledAt)))
    .orderBy(asc(users.name), asc(volunteerShiftSignups.id));

  const w = checkInWindow(shift, new Date());
  return {
    shift: { ...shift, checkInOpensAt: w.opensAt, checkInClosesAt: w.closesAt, checkInOpen: w.open },
    entries: rows,
  };
}

interface LockedShift {
  id: string;
  programId: string | null;
  title: string;
  category: VolunteerCategory;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
}

/**
 * Shared by check-in and walk-in. Caller holds a FOR UPDATE lock on the signup
 * row. Inserts the ledger entry and stamps the signup.
 */
async function performCheckIn(
  tx: DbTx,
  ctx: SessionContext,
  signup: { id: string; userId: string; cancelledAt: Date | null; checkedInAt: Date | null },
  shift: LockedShift,
  extraMeta: Record<string, unknown> = {}
): Promise<{ logId: string }> {
  if (!canCheckIn(ctx, shift.programId)) {
    throw new DalError("FORBIDDEN", "You do not have permission to check volunteers in.");
  }
  if (shift.cancelledAt) throw new DalError("INVALID", "This shift was cancelled.");
  if (signup.cancelledAt) throw new DalError("INVALID", "This sign-up was cancelled.");
  if (signup.checkedInAt) throw new DalError("INVALID", "This volunteer is already checked in.");
  const now = new Date();
  const w = checkInWindow(shift, now);
  if (!w.open) {
    throw new DalError(
      "INVALID",
      now < w.opensAt
        ? "Check-in opens 2 hours before the shift starts."
        : "Check-in closed 7 days after the shift ended."
    );
  }
  const minutes = Math.round((shift.endsAt.getTime() - shift.startsAt.getTime()) / 60_000);
  if (minutes < 1 || minutes > 1440) {
    throw new DalError("INVALID", "This shift's length cannot be logged.");
  }

  const [log] = await tx
    .insert(volunteerLogs)
    .values({
      userId: signup.userId,
      programId: shift.programId,
      shiftId: shift.id,
      category: shift.category,
      activityDate: shift.startsAt,
      durationMinutes: minutes,
      description: `Shift check-in: ${shift.title}`,
      verificationMethod: "shift_checkin",
      createdByUserId: ctx.userId,
      approvedByUserId: ctx.userId,
      approvedAt: now,
      inKindRateCents: currentInKindRateCents(),
    })
    .returning({ id: volunteerLogs.id });
  await tx
    .update(volunteerShiftSignups)
    .set({ checkedInAt: now, checkedInByUserId: ctx.userId, volunteerLogId: log.id })
    .where(eq(volunteerShiftSignups.id, signup.id));
  await writeAudit(
    {
      actorUserId: ctx.userId,
      action: "shift.checked_in",
      targetType: "shift_signup",
      targetId: signup.id,
      metadata: {
        shiftId: shift.id,
        volunteerUserId: signup.userId,
        logId: log.id,
        minutes,
        ...extraMeta,
      },
    },
    tx
  );
  return { logId: log.id };
}

function mapUniqueViolation(err: unknown): never {
  if (pgCode(err) === "23505") {
    throw new DalError("INVALID", "This volunteer already has a ledger entry for this shift.");
  }
  throw err;
}

export async function checkInSignup(ctx: SessionContext, signupId: string): Promise<{ logId: string }> {
  assertUuid(signupId, "Sign-up");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          signup: {
            id: volunteerShiftSignups.id,
            userId: volunteerShiftSignups.userId,
            cancelledAt: volunteerShiftSignups.cancelledAt,
            checkedInAt: volunteerShiftSignups.checkedInAt,
          },
          shift: {
            id: volunteerShifts.id,
            programId: volunteerShifts.programId,
            title: volunteerShifts.title,
            category: volunteerShifts.category,
            startsAt: volunteerShifts.startsAt,
            endsAt: volunteerShifts.endsAt,
            cancelledAt: volunteerShifts.cancelledAt,
          },
        })
        .from(volunteerShiftSignups)
        .innerJoin(volunteerShifts, eq(volunteerShifts.id, volunteerShiftSignups.shiftId))
        .where(eq(volunteerShiftSignups.id, signupId))
        .for("update", { of: volunteerShiftSignups });
      if (!row) throw new DalError("NOT_FOUND", "Sign-up not found.");
      return performCheckIn(tx, ctx, row.signup, row.shift);
    });
  } catch (err) {
    return mapUniqueViolation(err);
  }
}

export async function undoCheckIn(ctx: SessionContext, signupId: string, reason: string): Promise<void> {
  assertUuid(signupId, "Sign-up");
  const why = undoReasonSchema.parse(reason);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: volunteerShiftSignups.id,
        userId: volunteerShiftSignups.userId,
        checkedInAt: volunteerShiftSignups.checkedInAt,
        volunteerLogId: volunteerShiftSignups.volunteerLogId,
        shiftId: volunteerShifts.id,
        programId: volunteerShifts.programId,
      })
      .from(volunteerShiftSignups)
      .innerJoin(volunteerShifts, eq(volunteerShifts.id, volunteerShiftSignups.shiftId))
      .where(eq(volunteerShiftSignups.id, signupId))
      .for("update", { of: volunteerShiftSignups });
    if (!row) throw new DalError("NOT_FOUND", "Sign-up not found.");
    if (!canCheckIn(ctx, row.programId)) {
      throw new DalError("FORBIDDEN", "You do not have permission to undo check-ins.");
    }
    if (!row.checkedInAt || !row.volunteerLogId) {
      throw new DalError("INVALID", "This volunteer is not checked in.");
    }
    const now = new Date();
    await tx
      .update(volunteerLogs)
      .set({ deletedAt: now, deletedByUserId: ctx.userId, deletionReason: why })
      .where(and(eq(volunteerLogs.id, row.volunteerLogId), isNull(volunteerLogs.deletedAt)));
    await tx
      .update(volunteerShiftSignups)
      .set({ checkedInAt: null, checkedInByUserId: null, volunteerLogId: null })
      .where(eq(volunteerShiftSignups.id, signupId));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "shift.checkin_undone",
        targetType: "shift_signup",
        targetId: signupId,
        metadata: { shiftId: row.shiftId, volunteerUserId: row.userId, logId: row.volunteerLogId, reason: why },
      },
      tx
    );
  });
}

/**
 * Walk-in: the volunteer must already have an account. Creates (or revives) the
 * sign-up even when the shift is full, then checks them in.
 */
export async function addWalkInAndCheckIn(
  ctx: SessionContext,
  shiftId: string,
  emailRaw: string
): Promise<{ signupId: string; logId: string }> {
  assertUuid(shiftId);
  const email = walkInEmailSchema.parse(emailRaw);
  try {
    return await db.transaction(async (tx) => {
      const [shift] = await tx
        .select()
        .from(volunteerShifts)
        .where(eq(volunteerShifts.id, shiftId))
        .for("update");
      if (!shift) throw new DalError("NOT_FOUND", "Shift not found.");
      if (!canCheckIn(ctx, shift.programId)) {
        throw new DalError("FORBIDDEN", "You do not have permission to check volunteers in.");
      }
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)))
        .limit(1);
      if (!user) {
        throw new DalError("INVALID", "No account found for that email. Ask them to sign in once first.");
      }

      let [signup] = await tx
        .select()
        .from(volunteerShiftSignups)
        .where(and(eq(volunteerShiftSignups.shiftId, shiftId), eq(volunteerShiftSignups.userId, user.id)))
        .for("update");
      if (signup?.checkedInAt) throw new DalError("INVALID", "This volunteer is already checked in.");
      if (signup) {
        if (signup.cancelledAt) {
          await tx
            .update(volunteerShiftSignups)
            .set({ cancelledAt: null, signedUpAt: new Date() })
            .where(eq(volunteerShiftSignups.id, signup.id));
          signup = { ...signup, cancelledAt: null };
        }
      } else {
        [signup] = await tx
          .insert(volunteerShiftSignups)
          .values({ shiftId, userId: user.id })
          .returning();
      }
      const { logId } = await performCheckIn(tx, ctx, signup, shift, { walkIn: true });
      return { signupId: signup.id, logId };
    });
  } catch (err) {
    return mapUniqueViolation(err);
  }
}

/** Programs the viewer may create shifts for (board: all active; plus an org-wide option in the UI). */
export async function listShiftProgramOptions(
  ctx: SessionContext
): Promise<{ programs: { id: string; name: string }[]; canOrgWide: boolean }> {
  const rows = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(and(eq(programs.isActive, true), isNull(programs.deletedAt)))
    .orderBy(asc(programs.name));
  return {
    programs: rows.filter((p) => canManageShifts(ctx, p.id)),
    canOrgWide: isBoard(ctx),
  };
}
