import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { programs, users, volunteerLogs } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import { inKindValueCents } from "@/lib/grant-rate";
import { getInKindRateCents } from "./settings";
import type { VerificationMethod, VolunteerCategory } from "@/lib/volunteer-categories";
import {
  assertDateInWindow,
  logHoursForVolunteerSchema,
  logHoursSchema,
  logIdSchema,
  rejectReasonSchema,
  type LogHoursForVolunteerInput,
  type LogHoursInput,
} from "@/lib/validation/hours";
import { DalError, isBoard, type SessionContext } from "./context";

/*
 * Volunteer hours ledger (invariant 7). volunteer_logs rows are immutable: this module only ever
 *  - inserts rows,
 *  - approves (self_reported -> admin_approved + approvedBy/approvedAt), and
 *  - soft-deletes (deletedAt/deletedByUserId/deletionReason).
 * Hours, dates, category and rate are never updated.
 */

export const WITHDRAWN_REASON = "Withdrawn by volunteer";
const PENDING_LIMIT = 500;

export interface HoursEntryRow {
  id: string;
  activityDate: Date;
  programId: string | null;
  programName: string | null;
  category: VolunteerCategory;
  durationMinutes: number;
  description: string | null;
  verificationMethod: VerificationMethod;
  inKindRateCents: number | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  /** Entered by someone other than the volunteer (board on behalf, or shift check-in). */
  enteredByOther: boolean;
  createdAt: Date;
  shiftId: string | null;
  /** Set only on rejected/removed rows. */
  deletedAt: Date | null;
  deletionReason: string | null;
  deletedByName: string | null;
}

export interface MyHours {
  year: number;
  entries: HoursEntryRow[];
  /** Soft-deleted by someone else (board rejection or coordinator undo). Withdrawn rows are hidden. */
  rejected: HoursEntryRow[];
}

export interface HoursSummary {
  year: number;
  verifiedMinutes: number;
  verifiedValueCents: number;
  pendingMinutes: number;
}

export interface PendingHoursRow {
  id: string;
  userId: string;
  volunteerName: string;
  volunteerEmail: string;
  programName: string | null;
  category: VolunteerCategory;
  activityDate: Date;
  durationMinutes: number;
  description: string | null;
  createdAt: Date;
  /** True for the signed-in reviewer's own entries (they cannot approve them). */
  isOwn: boolean;
}

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

/** Calendar-year bounds in America/Los_Angeles: [start of Jan 1, start of next Jan 1). */
export function laYearBounds(year: number): { start: Date; end: Date } {
  return {
    start: laDateInputToUtc(`${year}-01-01`, false),
    end: laDateInputToUtc(`${year + 1}-01-01`, false),
  };
}

export function laYearOf(now: Date): number {
  return Number(utcToLaDateInput(now).slice(0, 4));
}

function parseLogId(v: string): string {
  const r = logIdSchema.safeParse(v);
  if (!r.success) throw new DalError("NOT_FOUND", "Entry not found.");
  return r.data;
}

function parseOrInvalid<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DalError("INVALID", r.error.issues[0]?.message ?? "Invalid input.");
  return r.data;
}

async function assertProgramUsable(programId: string | null) {
  if (programId === null) return;
  const [p] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.id, programId), eq(programs.isActive, true), isNull(programs.deletedAt)))
    .limit(1);
  if (!p) throw new DalError("INVALID", "Choose an active program.");
}

// ---------------------------------------------------------------------------
// Member
// ---------------------------------------------------------------------------

export async function logMyHours(
  ctx: SessionContext,
  input: LogHoursInput,
  now: Date = new Date()
): Promise<{ id: string }> {
  const data = parseOrInvalid(logHoursSchema, input);
  const windowError = assertDateInWindow(data.activityDate, now);
  if (windowError) throw new DalError("INVALID", windowError);
  await assertProgramUsable(data.programId);

  const [row] = await db
    .insert(volunteerLogs)
    .values({
      userId: ctx.userId,
      programId: data.programId,
      category: data.category,
      activityDate: laDateInputToUtc(data.activityDate, false),
      durationMinutes: data.durationMinutes,
      description: data.description,
      verificationMethod: "self_reported",
      createdByUserId: ctx.userId,
      inKindRateCents: await getInKindRateCents(),
    })
    .returning({ id: volunteerLogs.id });

  await writeAudit({
    actorUserId: ctx.userId,
    action: "hours.logged",
    targetType: "volunteer_log",
    targetId: row.id,
    metadata: {
      programId: data.programId,
      category: data.category,
      durationMinutes: data.durationMinutes,
      activityDate: data.activityDate,
    },
  });
  return { id: row.id };
}

const approver = alias(users, "approver");
const deleter = alias(users, "deleter");

/** My ledger for an LA calendar year (default: this year). */
export async function listMyHours(
  ctx: SessionContext,
  opts: { year?: number } = {},
  now: Date = new Date()
): Promise<MyHours> {
  const year = opts.year ?? laYearOf(now);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DalError("INVALID", "Invalid year.");
  }
  const { start, end } = laYearBounds(year);

  const rows = await db
    .select({
      id: volunteerLogs.id,
      activityDate: volunteerLogs.activityDate,
      programId: volunteerLogs.programId,
      programName: programs.name,
      category: volunteerLogs.category,
      durationMinutes: volunteerLogs.durationMinutes,
      description: volunteerLogs.description,
      verificationMethod: volunteerLogs.verificationMethod,
      inKindRateCents: volunteerLogs.inKindRateCents,
      approvedAt: volunteerLogs.approvedAt,
      approvedByName: approver.name,
      createdByUserId: volunteerLogs.createdByUserId,
      createdAt: volunteerLogs.createdAt,
      shiftId: volunteerLogs.shiftId,
      deletedAt: volunteerLogs.deletedAt,
      deletedByUserId: volunteerLogs.deletedByUserId,
      deletionReason: volunteerLogs.deletionReason,
      deletedByName: deleter.name,
    })
    .from(volunteerLogs)
    .leftJoin(programs, eq(programs.id, volunteerLogs.programId))
    .leftJoin(approver, eq(approver.id, volunteerLogs.approvedByUserId))
    .leftJoin(deleter, eq(deleter.id, volunteerLogs.deletedByUserId))
    .where(
      and(
        eq(volunteerLogs.userId, ctx.userId),
        gte(volunteerLogs.activityDate, start),
        lt(volunteerLogs.activityDate, end)
      )
    )
    .orderBy(desc(volunteerLogs.activityDate), desc(volunteerLogs.createdAt));

  const entries: HoursEntryRow[] = [];
  const rejected: HoursEntryRow[] = [];
  for (const r of rows) {
    const { createdByUserId, deletedByUserId, ...rest } = r;
    const entry: HoursEntryRow = {
      ...rest,
      enteredByOther: createdByUserId !== null && createdByUserId !== ctx.userId,
    };
    if (r.deletedAt === null) entries.push(entry);
    else if (deletedByUserId !== null && deletedByUserId !== ctx.userId) rejected.push(entry);
    // else: withdrawn by the volunteer themselves -> hidden
  }
  return { year, entries, rejected };
}

/** YTD (LA calendar year) verified vs pending minutes for the signed-in volunteer. */
export async function getMyHoursSummary(
  ctx: SessionContext,
  now: Date = new Date()
): Promise<HoursSummary> {
  const year = laYearOf(now);
  const { start, end } = laYearBounds(year);
  const rows = await db
    .select({
      minutes: volunteerLogs.durationMinutes,
      rate: volunteerLogs.inKindRateCents,
      method: volunteerLogs.verificationMethod,
    })
    .from(volunteerLogs)
    .where(
      and(
        eq(volunteerLogs.userId, ctx.userId),
        isNull(volunteerLogs.deletedAt),
        gte(volunteerLogs.activityDate, start),
        lt(volunteerLogs.activityDate, end)
      )
    );
  const fallbackRate = await getInKindRateCents();
  let verifiedMinutes = 0;
  let verifiedValueCents = 0;
  let pendingMinutes = 0;
  for (const r of rows) {
    if (r.method === "self_reported") {
      pendingMinutes += r.minutes;
    } else {
      verifiedMinutes += r.minutes;
      verifiedValueCents += inKindValueCents(r.minutes, r.rate ?? fallbackRate);
    }
  }
  return { year, verifiedMinutes, verifiedValueCents, pendingMinutes };
}

/** Withdraw my own pending (self-reported, unapproved) entry: soft delete. */
export async function withdrawMyHours(ctx: SessionContext, logId: string): Promise<void> {
  const id = parseLogId(logId);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: volunteerLogs.id,
        userId: volunteerLogs.userId,
        method: volunteerLogs.verificationMethod,
        deletedAt: volunteerLogs.deletedAt,
      })
      .from(volunteerLogs)
      .where(eq(volunteerLogs.id, id))
      .for("update")
      .limit(1);
    // Hide other people's rows behind NOT_FOUND.
    if (!row || row.userId !== ctx.userId) throw new DalError("NOT_FOUND", "Entry not found.");
    if (row.deletedAt) throw new DalError("INVALID", "This entry was already removed.");
    if (row.method !== "self_reported") {
      throw new DalError("INVALID", "Only entries awaiting approval can be withdrawn.");
    }
    await tx
      .update(volunteerLogs)
      .set({ deletedAt: new Date(), deletedByUserId: ctx.userId, deletionReason: WITHDRAWN_REASON })
      .where(eq(volunteerLogs.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "hours.deleted",
        targetType: "volunteer_log",
        targetId: id,
        metadata: { reason: WITHDRAWN_REASON },
      },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export async function listPendingHours(ctx: SessionContext): Promise<PendingHoursRow[]> {
  requireBoard(ctx);
  const rows = await db
    .select({
      id: volunteerLogs.id,
      userId: volunteerLogs.userId,
      volunteerName: users.name,
      volunteerEmail: users.email,
      programName: programs.name,
      category: volunteerLogs.category,
      activityDate: volunteerLogs.activityDate,
      durationMinutes: volunteerLogs.durationMinutes,
      description: volunteerLogs.description,
      createdAt: volunteerLogs.createdAt,
    })
    .from(volunteerLogs)
    .innerJoin(users, eq(users.id, volunteerLogs.userId))
    .leftJoin(programs, eq(programs.id, volunteerLogs.programId))
    .where(and(eq(volunteerLogs.verificationMethod, "self_reported"), isNull(volunteerLogs.deletedAt)))
    .orderBy(asc(volunteerLogs.createdAt))
    .limit(PENDING_LIMIT);
  return rows.map((r) => ({ ...r, isOwn: r.userId === ctx.userId }));
}

/** Locks a pending entry for a board decision; throws if missing or not pending. */
async function lockPending(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string) {
  const [row] = await tx
    .select({
      id: volunteerLogs.id,
      userId: volunteerLogs.userId,
      method: volunteerLogs.verificationMethod,
      deletedAt: volunteerLogs.deletedAt,
      durationMinutes: volunteerLogs.durationMinutes,
    })
    .from(volunteerLogs)
    .where(eq(volunteerLogs.id, id))
    .for("update")
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Entry not found.");
  return row;
}

function assertPending(row: { method: VerificationMethod; deletedAt: Date | null }) {
  if (row.deletedAt || row.method !== "self_reported") {
    throw new DalError("INVALID", "This entry has already been decided or withdrawn.");
  }
}

export async function approveHours(ctx: SessionContext, logId: string): Promise<void> {
  requireBoard(ctx);
  const id = parseLogId(logId);
  await db.transaction(async (tx) => {
    const row = await lockPending(tx, id);
    if (row.userId === ctx.userId) {
      throw new DalError("FORBIDDEN", "You cannot approve your own hours. Ask another board member.");
    }
    assertPending(row);
    const now = new Date();
    await tx
      .update(volunteerLogs)
      .set({ verificationMethod: "admin_approved", approvedByUserId: ctx.userId, approvedAt: now })
      .where(eq(volunteerLogs.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "hours.approved",
        targetType: "volunteer_log",
        targetId: id,
        metadata: { volunteerUserId: row.userId, durationMinutes: row.durationMinutes },
      },
      tx
    );
  });
}

export async function rejectHours(ctx: SessionContext, logId: string, reason: string): Promise<void> {
  requireBoard(ctx);
  const id = parseLogId(logId);
  const why = parseOrInvalid(rejectReasonSchema, reason);
  await db.transaction(async (tx) => {
    const row = await lockPending(tx, id);
    assertPending(row);
    await tx
      .update(volunteerLogs)
      .set({ deletedAt: new Date(), deletedByUserId: ctx.userId, deletionReason: why })
      .where(eq(volunteerLogs.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "hours.rejected",
        targetType: "volunteer_log",
        targetId: id,
        metadata: { volunteerUserId: row.userId, durationMinutes: row.durationMinutes, reason: why },
      },
      tx
    );
  });
}

/** Board logs hours for someone else; stored already approved (admin_approved). */
export async function logHoursForVolunteer(
  ctx: SessionContext,
  input: LogHoursForVolunteerInput,
  now: Date = new Date()
): Promise<{ id: string }> {
  requireBoard(ctx);
  const data = parseOrInvalid(logHoursForVolunteerSchema, input);
  const windowError = assertDateInWindow(data.activityDate, now);
  if (windowError) throw new DalError("INVALID", windowError);
  await assertProgramUsable(data.programId);

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${data.email}`, isNull(users.deletedAt)))
    .limit(1);
  if (!target) {
    throw new DalError("NOT_FOUND", "No volunteer with that email. Ask them to sign in once first.");
  }
  if (target.id === ctx.userId) {
    throw new DalError(
      "FORBIDDEN",
      "You cannot approve your own hours. Use the self-report form so another board member reviews them."
    );
  }

  const [row] = await db
    .insert(volunteerLogs)
    .values({
      userId: target.id,
      programId: data.programId,
      category: data.category,
      activityDate: laDateInputToUtc(data.activityDate, false),
      durationMinutes: data.durationMinutes,
      description: data.description,
      verificationMethod: "admin_approved",
      createdByUserId: ctx.userId,
      approvedByUserId: ctx.userId,
      approvedAt: now,
      inKindRateCents: await getInKindRateCents(),
    })
    .returning({ id: volunteerLogs.id });

  await writeAudit({
    actorUserId: ctx.userId,
    action: "hours.logged",
    targetType: "volunteer_log",
    targetId: row.id,
    metadata: {
      onBehalfOf: target.id,
      programId: data.programId,
      category: data.category,
      durationMinutes: data.durationMinutes,
      activityDate: data.activityDate,
    },
  });
  return { id: row.id };
}
