import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { programs, resourceBookings, resources, teamEvents, teams, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { formatTimeRange } from "@/lib/format";
import {
  MAX_CALENDAR_DAYS,
  buildFacilityTree,
  directBookingSchema,
  facilitySchema,
  noteSchema,
  reasonSchema,
  uuidSchema,
  type BookingStatus,
  type DirectBookingFormInput,
  type FacilityFormInput,
  type FacilityNode,
  type FacilityRow,
} from "@/lib/validation/facilities";
import {
  facilityRootId,
  findBookingConflicts,
  insertBooking,
  lockFacilityTree,
  type BookingConflict,
} from "./booking-engine";
import { DalError, isBoard, type SessionContext } from "./context";
import { assertProgramReachable, canApproveBookings, canManageFacilities } from "./permissions";

/**
 * Facility tree + booking approvals (Phase 2 / S1). All conflict detection goes
 * through booking-engine; every path that approves a booking holds the booking
 * row lock AND the tree advisory lock, then re-checks conflicts in the same tx.
 */

export class BookingConflictError extends DalError {
  constructor(public conflicts: BookingConflict[], lead = "That time is already booked") {
    super(
      "INVALID",
      `${lead}: ${conflicts
        .slice(0, 3)
        .map((c) => `${c.title} (${c.resourceName}, ${formatTimeRange(c.startsAt, c.endsAt)})`)
        .join("; ")}${conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ""}.`
    );
    this.name = "BookingConflictError";
  }
}

const forbidden = () => new DalError("FORBIDDEN", "You do not have permission to do that.");

// ---- Facility tree -------------------------------------------------------------

function toRow(r: typeof resources.$inferSelect): FacilityRow {
  return {
    id: r.id,
    parentResourceId: r.parentResourceId,
    name: r.name,
    kind: r.kind,
    locationAddress: r.locationAddress,
    notes: r.notes,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
  };
}

/**
 * The facility tree. Any signed-in user may read ACTIVE facilities (pickers);
 * inactive ones are included only for the board and only with includeInactive.
 */
export async function listFacilities(ctx: SessionContext, opts: { includeInactive?: boolean } = {}): Promise<FacilityNode[]> {
  const withInactive = !!opts.includeInactive && canManageFacilities(ctx);
  const rows = await db
    .select()
    .from(resources)
    .where(withInactive ? undefined : eq(resources.isActive, true));
  return buildFacilityTree(rows.map(toRow));
}

async function loadFacility(tx: DbTx, id: string) {
  const [row] = await tx.select().from(resources).where(eq(resources.id, id)).limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Facility not found.");
  return row;
}

/** Walk up from `startId`; returns the chain of ids (start first). Refuses >32 levels / loops. */
async function ancestorChain(tx: DbTx, startId: string): Promise<string[]> {
  const chain: string[] = [];
  let cur: string | null = startId;
  while (cur) {
    if (chain.includes(cur) || chain.length > 32) throw new DalError("INVALID", "The facility tree is too deep or contains a loop.");
    chain.push(cur);
    const [r] = await tx.select({ p: resources.parentResourceId }).from(resources).where(eq(resources.id, cur)).limit(1);
    cur = r?.p ?? null;
  }
  return chain;
}

async function subtreeIdList(tx: DbTx, id: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    with recursive down as (
      select id, 0 as depth from resources where id = ${id}
      union all
      select r.id, down.depth + 1 from resources r join down on r.parent_resource_id = down.id where down.depth < 32
    ) select id from down
  `);
  return rows.rows.map((r) => r.id);
}

/** Serialize all structural edits (re-parenting) so two moves cannot create a cycle together. */
async function lockStructure(tx: DbTx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('facility-structure'))`);
}

/** Lock the booking trees containing each given node, in a stable (root id) order. */
async function lockTreesOf(tx: DbTx, resourceIds: string[]) {
  const roots = new Set<string>();
  for (const id of resourceIds) roots.add(await facilityRootId(tx, id));
  for (const root of [...roots].sort()) await lockFacilityTree(tx, root);
}

async function assertSiblingNameFree(tx: DbTx, parentId: string | null, name: string, exceptId?: string) {
  const rows = await tx
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        parentId ? eq(resources.parentResourceId, parentId) : isNull(resources.parentResourceId),
        sql`lower(${resources.name}) = lower(${name})`,
        exceptId ? ne(resources.id, exceptId) : undefined
      )
    )
    .limit(1);
  if (rows.length) throw new DalError("INVALID", `There is already a facility named "${name}" here.`);
}

export async function createFacility(ctx: SessionContext, raw: FacilityFormInput): Promise<{ id: string }> {
  if (!canManageFacilities(ctx)) throw forbidden();
  const input = facilitySchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockStructure(tx);
    if (input.parentId) {
      const parent = await loadFacility(tx, input.parentId);
      if (!parent.isActive) throw new DalError("INVALID", "The parent facility is inactive.");
      if ((await ancestorChain(tx, parent.id)).length >= 8) throw new DalError("INVALID", "Facilities can be nested at most 8 levels deep.");
    }
    await assertSiblingNameFree(tx, input.parentId, input.name);
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${resources.sortOrder}), -1) + 1`.mapWith(Number) })
      .from(resources)
      .where(input.parentId ? eq(resources.parentResourceId, input.parentId) : isNull(resources.parentResourceId));
    const [row] = await tx
      .insert(resources)
      .values({
        name: input.name,
        kind: input.kind,
        parentResourceId: input.parentId,
        locationAddress: input.locationAddress,
        notes: input.notes,
        sortOrder: next,
      })
      .returning({ id: resources.id });
    await writeAudit(
      { actorUserId: ctx.userId, action: "facility.created", targetType: "facility", targetId: row.id, metadata: { name: input.name, kind: input.kind, parentId: input.parentId } },
      tx
    );
    return { id: row.id };
  });
}

/**
 * Edit / re-parent. Refuses cycles (a node cannot move under itself or a
 * descendant) and refuses a move that would put overlapping approved future
 * bookings into the same ancestor/descendant chain.
 */
export async function updateFacility(
  ctx: SessionContext,
  id: string,
  raw: FacilityFormInput & { sortOrder?: number }
): Promise<void> {
  if (!canManageFacilities(ctx)) throw forbidden();
  uuidSchema.parse(id);
  const input = facilitySchema.parse(raw);
  const sortOrder = raw.sortOrder === undefined ? undefined : Math.trunc(Number(raw.sortOrder));
  if (sortOrder !== undefined && (!Number.isFinite(sortOrder) || sortOrder < 0 || sortOrder > 9999)) {
    throw new DalError("INVALID", "Sort order must be between 0 and 9999.");
  }
  await db.transaction(async (tx) => {
    await lockStructure(tx);
    const cur = await loadFacility(tx, id);
    const reparent = input.parentId !== cur.parentResourceId;
    if (reparent) {
      if (input.parentId) {
        if (input.parentId === id) throw new DalError("INVALID", "A facility cannot be its own parent.");
        const chain = await ancestorChain(tx, input.parentId);
        if (chain.includes(id)) throw new DalError("INVALID", "A facility cannot be moved under one of its own sub-facilities.");
        const parent = await loadFacility(tx, input.parentId);
        if (!parent.isActive) throw new DalError("INVALID", "The new parent facility is inactive.");
        if (chain.length >= 8) throw new DalError("INVALID", "Facilities can be nested at most 8 levels deep.");
      }
      // Bookings are locked per tree: hold both the old and new trees for the move.
      await lockTreesOf(tx, [id, ...(input.parentId ? [input.parentId] : [])]);
    }
    if (reparent || input.name.toLowerCase() !== cur.name.toLowerCase()) {
      await assertSiblingNameFree(tx, input.parentId, input.name, id);
    }
    await tx
      .update(resources)
      .set({
        name: input.name,
        kind: input.kind,
        parentResourceId: input.parentId,
        locationAddress: input.locationAddress,
        notes: input.notes,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      })
      .where(eq(resources.id, id));
    if (reparent) {
      // The move changes which nodes block each other: no future approved booking may now overlap another.
      const ids = await subtreeIdList(tx, id);
      const future = await tx
        .select()
        .from(resourceBookings)
        .where(and(inArray(resourceBookings.resourceId, ids), eq(resourceBookings.status, "approved"), gt(resourceBookings.endsAt, new Date())));
      for (const b of future) {
        const conflicts = await findBookingConflicts(tx, { resourceId: b.resourceId, startsAt: b.startsAt, endsAt: b.endsAt, excludeBookingId: b.id });
        if (conflicts.length) throw new BookingConflictError(conflicts, `Moving this facility would double-book "${b.title}" with`);
      }
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "facility.updated",
        targetType: "facility",
        targetId: id,
        metadata: { name: input.name, kind: input.kind, from: cur.parentResourceId, parentId: input.parentId, renamedFrom: cur.name !== input.name ? cur.name : undefined },
      },
      tx
    );
  });
}

export interface FutureBookingRef {
  id: string;
  title: string;
  resourceName: string;
  startsAt: Date;
  endsAt: Date;
}

/** Future approved bookings on a facility and everything under it (shown when deactivation is refused). */
export async function listFutureBookingsForFacility(ctx: SessionContext, id: string): Promise<FutureBookingRef[]> {
  if (!canManageFacilities(ctx)) throw forbidden();
  return db.transaction((tx) => futureApprovedUnder(tx, id));
}

async function futureApprovedUnder(tx: DbTx, id: string): Promise<FutureBookingRef[]> {
  const ids = await subtreeIdList(tx, id);
  return tx
    .select({ id: resourceBookings.id, title: resourceBookings.title, resourceName: resources.name, startsAt: resourceBookings.startsAt, endsAt: resourceBookings.endsAt })
    .from(resourceBookings)
    .innerJoin(resources, eq(resources.id, resourceBookings.resourceId))
    .where(and(inArray(resourceBookings.resourceId, ids), eq(resourceBookings.status, "approved"), gt(resourceBookings.endsAt, new Date())))
    .orderBy(asc(resourceBookings.startsAt));
}

/** Deactivate a facility and its sub-facilities. Refused while future approved bookings exist. */
export async function deactivateFacility(ctx: SessionContext, id: string): Promise<{ deactivated: number }> {
  if (!canManageFacilities(ctx)) throw forbidden();
  uuidSchema.parse(id);
  return db.transaction(async (tx) => {
    await lockStructure(tx);
    const cur = await loadFacility(tx, id);
    await lockFacilityTree(tx, id);
    const future = await futureApprovedUnder(tx, id);
    if (future.length) {
      const sample = future
        .slice(0, 3)
        .map((b) => `${b.title} (${b.resourceName}, ${formatTimeRange(b.startsAt, b.endsAt)})`)
        .join("; ");
      throw new DalError(
        "INVALID",
        `${cur.name} has ${future.length} upcoming approved booking${future.length === 1 ? "" : "s"}: ${sample}${future.length > 3 ? ` and ${future.length - 3} more` : ""}. Cancel them first.`
      );
    }
    const ids = await subtreeIdList(tx, id);
    await tx.update(resources).set({ isActive: false }).where(inArray(resources.id, ids));
    await writeAudit({ actorUserId: ctx.userId, action: "facility.updated", targetType: "facility", targetId: id, metadata: { isActive: false, cascaded: ids.length - 1 } }, tx);
    return { deactivated: ids.length };
  });
}

export async function reactivateFacility(ctx: SessionContext, id: string): Promise<void> {
  if (!canManageFacilities(ctx)) throw forbidden();
  uuidSchema.parse(id);
  await db.transaction(async (tx) => {
    await lockStructure(tx);
    const cur = await loadFacility(tx, id);
    if (cur.parentResourceId) {
      const parent = await loadFacility(tx, cur.parentResourceId);
      if (!parent.isActive) throw new DalError("INVALID", "Reactivate the parent facility first.");
    }
    await tx.update(resources).set({ isActive: true }).where(eq(resources.id, id));
    await writeAudit({ actorUserId: ctx.userId, action: "facility.updated", targetType: "facility", targetId: id, metadata: { isActive: true } }, tx);
  });
}

// ---- Direct bookings -----------------------------------------------------------

/**
 * Book a facility immediately (approved). Program admins for their program;
 * the board for any program or for none (maintenance block).
 */
export async function createDirectBooking(ctx: SessionContext, raw: DirectBookingFormInput): Promise<{ id: string }> {
  const input = directBookingSchema.parse(raw);
  if (!canApproveBookings(ctx, input.programId)) throw forbidden();
  if (input.programId) await assertProgramReachable(ctx, input.programId);
  return db.transaction(async (tx) => {
    const facility = await loadFacility(tx, input.resourceId);
    if (!facility.isActive) throw new DalError("INVALID", "That facility is inactive.");
    if (input.programId) {
      const [p] = await tx.select({ id: programs.id }).from(programs).where(and(eq(programs.id, input.programId), isNull(programs.deletedAt))).limit(1);
      if (!p) throw new DalError("NOT_FOUND", "Program not found.");
    }
    const res = await insertBooking(tx, {
      resourceId: input.resourceId,
      programId: input.programId,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdByUserId: ctx.userId,
      notes: input.notes,
      autoApprove: true,
    });
    if (!res.ok) throw new BookingConflictError(res.conflicts);
    await writeAudit(
      { actorUserId: ctx.userId, action: "booking.created", targetType: "booking", targetId: res.bookingId, metadata: { resourceId: input.resourceId, programId: input.programId, startsAt: input.startsAt, endsAt: input.endsAt, title: input.title } },
      tx
    );
    return { id: res.bookingId };
  });
}

// ---- Approval queue ------------------------------------------------------------

export type RequestScope = { all: true } | { programId: string };

export interface BookingRequestRow {
  id: string;
  resourceId: string;
  resourceName: string;
  programId: string | null;
  programName: string | null;
  programSlug: string | null;
  title: string;
  notes: string | null;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  seriesId: string | null;
  /** Requested occurrences in the same series (including this one). */
  seriesPending: number;
  requesterId: string;
  requesterName: string;
  createdAt: Date;
  decisionNote: string | null;
  teamName: string | null;
  teamColor: string | null;
  isPast: boolean;
  /** Approved bookings that would block approving this request right now (requested rows only). */
  conflicts: BookingConflict[];
  /** Other pending requests competing for the same time on the same chain (requested rows only). */
  competing: { id: string; title: string; resourceName: string }[];
}

function authorizeScope(ctx: SessionContext, scope: RequestScope) {
  if ("all" in scope) {
    if (!isBoard(ctx)) throw forbidden();
  } else if (!canApproveBookings(ctx, scope.programId)) {
    throw forbidden();
  }
}

export async function listBookingRequests(
  ctx: SessionContext,
  opts: { scope: RequestScope; status?: BookingStatus | "all" }
): Promise<BookingRequestRow[]> {
  authorizeScope(ctx, opts.scope);
  const status = opts.status ?? "requested";
  if ("programId" in opts.scope) uuidSchema.parse(opts.scope.programId);
  const now = new Date();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: resourceBookings.id,
        resourceId: resourceBookings.resourceId,
        resourceName: resources.name,
        programId: resourceBookings.programId,
        programName: programs.name,
        programSlug: programs.slug,
        title: resourceBookings.title,
        notes: resourceBookings.notes,
        startsAt: resourceBookings.startsAt,
        endsAt: resourceBookings.endsAt,
        status: resourceBookings.status,
        seriesId: resourceBookings.seriesId,
        requesterId: resourceBookings.createdByUserId,
        requesterName: users.name,
        createdAt: resourceBookings.createdAt,
        decisionNote: resourceBookings.decisionNote,
        teamName: teams.name,
        teamColor: teams.color,
      })
      .from(resourceBookings)
      .innerJoin(resources, eq(resources.id, resourceBookings.resourceId))
      .innerJoin(users, eq(users.id, resourceBookings.createdByUserId))
      .leftJoin(programs, eq(programs.id, resourceBookings.programId))
      .leftJoin(teamEvents, eq(teamEvents.bookingId, resourceBookings.id))
      .leftJoin(teams, eq(teams.id, teamEvents.teamId))
      .where(
        and(
          status === "all" ? undefined : eq(resourceBookings.status, status),
          "all" in opts.scope ? undefined : eq(resourceBookings.programId, opts.scope.programId)
        )
      )
      .orderBy(status === "requested" ? asc(resourceBookings.startsAt) : desc(resourceBookings.startsAt))
      .limit(status === "requested" ? 300 : 100);

    const seriesIds = [...new Set(rows.flatMap((r) => (r.seriesId && r.status === "requested" ? [r.seriesId] : [])))];
    const seriesCounts = new Map<string, number>();
    if (seriesIds.length) {
      const counts = await tx
        .select({ seriesId: resourceBookings.seriesId, n: sql<number>`count(*)`.mapWith(Number) })
        .from(resourceBookings)
        .where(and(inArray(resourceBookings.seriesId, seriesIds), eq(resourceBookings.status, "requested")))
        .groupBy(resourceBookings.seriesId);
      for (const c of counts) if (c.seriesId) seriesCounts.set(c.seriesId, c.n);
    }

    const out: BookingRequestRow[] = [];
    for (const r of rows) {
      let conflicts: BookingConflict[] = [];
      let competing: BookingRequestRow["competing"] = [];
      if (r.status === "requested") {
        conflicts = await findBookingConflicts(tx, { resourceId: r.resourceId, startsAt: r.startsAt, endsAt: r.endsAt, excludeBookingId: r.id });
        const rel = await tx.execute<{ id: string; title: string; resource_name: string }>(sql`
          with recursive
            up as (select id, parent_resource_id, 0 d from resources where id = ${r.resourceId}
                   union all select x.id, x.parent_resource_id, up.d + 1 from resources x join up on x.id = up.parent_resource_id where up.d < 32),
            down as (select id, 0 d from resources where id = ${r.resourceId}
                   union all select x.id, down.d + 1 from resources x join down on x.parent_resource_id = down.id where down.d < 32)
          select b.id, b.title, res.name as resource_name
          from resource_bookings b join resources res on res.id = b.resource_id
          where b.status = 'requested' and b.id <> ${r.id}::uuid
            and b.resource_id in (select id from up union select id from down)
            and b.starts_at < ${r.endsAt} and b.ends_at > ${r.startsAt}
          order by b.created_at limit 5
        `);
        competing = rel.rows.map((x) => ({ id: x.id, title: x.title, resourceName: x.resource_name }));
      }
      out.push({
        ...r,
        seriesPending: r.seriesId ? (seriesCounts.get(r.seriesId) ?? 0) : 0,
        isPast: r.endsAt <= now,
        conflicts,
        competing,
      });
    }
    return out;
  });
}

/** Count of pending requests in a scope (tab badges). */
export async function countPendingRequests(ctx: SessionContext, scope: RequestScope): Promise<number> {
  authorizeScope(ctx, scope);
  const [r] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(resourceBookings)
    .where(
      and(
        eq(resourceBookings.status, "requested"),
        gt(resourceBookings.endsAt, new Date()),
        "all" in scope ? undefined : eq(resourceBookings.programId, scope.programId)
      )
    );
  return r?.n ?? 0;
}

// ---- Decisions ------------------------------------------------------------------

type BookingRow = typeof resourceBookings.$inferSelect;

async function lockBooking(tx: DbTx, id: string): Promise<BookingRow> {
  const [b] = await tx.select().from(resourceBookings).where(eq(resourceBookings.id, id)).for("update").limit(1);
  if (!b) throw new DalError("NOT_FOUND", "Booking not found.");
  return b;
}

/**
 * Approve one request inside an existing transaction: caller has authorized.
 * Row lock -> tree advisory lock -> conflict re-check (excluding itself) -> update.
 */
async function approveInTx(tx: DbTx, ctx: SessionContext, id: string, note: string | null, extraAudit: Record<string, unknown> = {}) {
  const b = await lockBooking(tx, id);
  if (!canApproveBookings(ctx, b.programId)) throw forbidden();
  if (b.status !== "requested") throw new DalError("INVALID", `This request was already ${b.status}.`);
  if (b.endsAt <= new Date()) throw new DalError("INVALID", "That time has already passed. Decline the request instead.");
  const facility = await loadFacility(tx, b.resourceId);
  if (!facility.isActive) throw new DalError("INVALID", `${facility.name} is inactive and cannot be booked.`);
  await lockFacilityTree(tx, b.resourceId);
  const conflicts = await findBookingConflicts(tx, { resourceId: b.resourceId, startsAt: b.startsAt, endsAt: b.endsAt, excludeBookingId: b.id });
  if (conflicts.length) throw new BookingConflictError(conflicts, "Cannot approve, it conflicts with");
  await tx
    .update(resourceBookings)
    .set({ status: "approved", decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note })
    .where(eq(resourceBookings.id, id));
  await writeAudit(
    { actorUserId: ctx.userId, action: "booking.approved", targetType: "booking", targetId: id, metadata: { resourceId: b.resourceId, programId: b.programId, title: b.title, note, ...extraAudit } },
    tx
  );
  return b;
}

export async function approveBooking(ctx: SessionContext, id: string, note?: string | null): Promise<void> {
  uuidSchema.parse(id);
  const n = noteSchema.parse(note ?? null);
  await db.transaction((tx) => approveInTx(tx, ctx, id, n));
}

export interface SeriesApprovalResult {
  approved: number;
  conflicted: { id: string; title: string; startsAt: Date; endsAt: Date; conflictsWith: BookingConflict[] }[];
  skipped: { id: string; startsAt: Date; reason: string }[];
}

/**
 * Approve every non-conflicting requested occurrence of a series (each in its
 * own locked transaction); report the ones that conflicted or were skipped.
 */
export async function approveSeries(ctx: SessionContext, seriesId: string, note?: string | null): Promise<SeriesApprovalResult> {
  uuidSchema.parse(seriesId);
  const n = noteSchema.parse(note ?? null);
  const pending = await db
    .select()
    .from(resourceBookings)
    .where(and(eq(resourceBookings.seriesId, seriesId), eq(resourceBookings.status, "requested")))
    .orderBy(asc(resourceBookings.startsAt));
  if (pending.length === 0) throw new DalError("NOT_FOUND", "No pending requests in that series.");
  if (pending.some((b) => !canApproveBookings(ctx, b.programId))) throw forbidden();

  const result: SeriesApprovalResult = { approved: 0, conflicted: [], skipped: [] };
  for (const b of pending) {
    try {
      await db.transaction((tx) => approveInTx(tx, ctx, b.id, n, { seriesId }));
      result.approved++;
    } catch (e) {
      if (e instanceof BookingConflictError) {
        result.conflicted.push({ id: b.id, title: b.title, startsAt: b.startsAt, endsAt: b.endsAt, conflictsWith: e.conflicts });
      } else if (e instanceof DalError && e.code !== "FORBIDDEN") {
        result.skipped.push({ id: b.id, startsAt: b.startsAt, reason: e.message });
      } else {
        throw e;
      }
    }
  }
  return result;
}

export async function declineBooking(ctx: SessionContext, id: string, reason: string): Promise<void> {
  uuidSchema.parse(id);
  const why = reasonSchema.parse(reason);
  await db.transaction(async (tx) => {
    const b = await lockBooking(tx, id);
    if (!canApproveBookings(ctx, b.programId)) throw forbidden();
    if (b.status !== "requested") throw new DalError("INVALID", `This request was already ${b.status}.`);
    await tx
      .update(resourceBookings)
      .set({ status: "declined", decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: why })
      .where(eq(resourceBookings.id, id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "booking.declined", targetType: "booking", targetId: id, metadata: { resourceId: b.resourceId, programId: b.programId, title: b.title, reason: why } },
      tx
    );
  });
}

/**
 * Cancel a requested or approved booking. Approvers may cancel either; the
 * requester may cancel only their own booking while it is still `requested`.
 * The reason is stored in decisionNote (no separate column) and in the audit row.
 */
export async function cancelBooking(ctx: SessionContext, id: string, reason: string): Promise<void> {
  uuidSchema.parse(id);
  const why = reasonSchema.parse(reason);
  await db.transaction(async (tx) => {
    const b = await lockBooking(tx, id);
    const approver = canApproveBookings(ctx, b.programId);
    const ownPending = b.createdByUserId === ctx.userId && b.status === "requested";
    if (!approver && !ownPending) throw forbidden();
    if (b.status !== "requested" && b.status !== "approved") throw new DalError("INVALID", `This booking is already ${b.status}.`);
    if (b.status === "approved" && b.endsAt <= new Date()) throw new DalError("INVALID", "That booking has already taken place.");
    await tx
      .update(resourceBookings)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledByUserId: ctx.userId, decisionNote: why })
      .where(eq(resourceBookings.id, id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "booking.cancelled", targetType: "booking", targetId: id, metadata: { resourceId: b.resourceId, programId: b.programId, title: b.title, was: b.status, reason: why } },
      tx
    );
  });
}

// ---- Calendar -------------------------------------------------------------------

export interface CalendarBooking {
  id: string;
  resourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: "requested" | "approved";
  programId: string | null;
  programName: string | null;
  seriesId: string | null;
  team: { id: string; name: string; color: string | null } | null;
  /** Another program's booking shown anonymously ("Booked") to a program admin. */
  busy: boolean;
}

export interface FacilityCalendar {
  facilities: FacilityNode[]; // depth-first, active only (within rootId if given)
  bookings: CalendarBooking[];
}

/**
 * Approved + requested bookings overlapping [from, to). Board: everything.
 * Program admin (programId): that program's bookings in full; other programs'
 * approved bookings appear only as anonymous busy blocks so they can plan around them.
 */
export async function getFacilityCalendar(
  ctx: SessionContext,
  opts: { from: Date; to: Date; rootId?: string | null; programId?: string | null }
): Promise<FacilityCalendar> {
  const programId = opts.programId ?? null;
  if (programId) {
    uuidSchema.parse(programId);
    if (!canApproveBookings(ctx, programId)) throw forbidden();
  } else if (!isBoard(ctx)) {
    throw forbidden();
  }
  if (opts.rootId) uuidSchema.parse(opts.rootId);
  if (!(opts.to > opts.from)) throw new DalError("INVALID", "Invalid date range.");
  if (opts.to.getTime() - opts.from.getTime() > MAX_CALENDAR_DAYS * 86_400_000) throw new DalError("INVALID", "Date range is too long.");

  const tree = await listFacilities(ctx);
  let roots = tree;
  if (opts.rootId) {
    const find = (list: FacilityNode[]): FacilityNode | null => {
      for (const n of list) {
        if (n.id === opts.rootId) return n;
        const f = find(n.children);
        if (f) return f;
      }
      return null;
    };
    const start = find(tree);
    if (!start) throw new DalError("NOT_FOUND", "Facility not found.");
    roots = [start];
  }
  const flat: FacilityNode[] = [];
  const walk = (list: FacilityNode[]) => list.forEach((n) => (flat.push(n), walk(n.children)));
  walk(roots);
  const ids = flat.map((f) => f.id);
  if (ids.length === 0) return { facilities: [], bookings: [] };

  const rows = await db
    .select({
      id: resourceBookings.id,
      resourceId: resourceBookings.resourceId,
      title: resourceBookings.title,
      startsAt: resourceBookings.startsAt,
      endsAt: resourceBookings.endsAt,
      status: resourceBookings.status,
      programId: resourceBookings.programId,
      programName: programs.name,
      seriesId: resourceBookings.seriesId,
      teamId: teams.id,
      teamName: teams.name,
      teamColor: teams.color,
    })
    .from(resourceBookings)
    .leftJoin(programs, eq(programs.id, resourceBookings.programId))
    .leftJoin(teamEvents, eq(teamEvents.bookingId, resourceBookings.id))
    .leftJoin(teams, eq(teams.id, teamEvents.teamId))
    .where(
      and(
        inArray(resourceBookings.resourceId, ids),
        inArray(resourceBookings.status, ["requested", "approved"]),
        lt(resourceBookings.startsAt, opts.to),
        gt(resourceBookings.endsAt, opts.from)
      )
    )
    .orderBy(asc(resourceBookings.startsAt));

  const bookings: CalendarBooking[] = [];
  for (const r of rows) {
    const mine = !programId || r.programId === programId;
    if (!mine && r.status !== "approved") continue; // others' pending requests stay private
    bookings.push({
      id: r.id,
      resourceId: r.resourceId,
      title: mine ? r.title : "Booked",
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status as "requested" | "approved",
      programId: mine ? r.programId : null,
      programName: mine ? r.programName : null,
      seriesId: mine ? r.seriesId : null,
      team: mine && r.teamId && r.teamName ? { id: r.teamId, name: r.teamName, color: r.teamColor } : null,
      busy: !mine,
    });
  }
  return { facilities: flat, bookings };
}

// ---- Program schedule page helper ------------------------------------------------

export async function getProgramForSchedule(ctx: SessionContext, slug: string) {
  const [program] = await db
    .select({ id: programs.id, slug: programs.slug, name: programs.name, isActive: programs.isActive })
    .from(programs)
    .where(and(eq(programs.slug, slug), isNull(programs.deletedAt)))
    .limit(1);
  if (!program || (!program.isActive && !isBoard(ctx))) throw new DalError("NOT_FOUND", "Program not found.");
  if (!canApproveBookings(ctx, program.id)) throw forbidden();
  return program;
}

/** Programs a user may attach a direct booking to (board: all active; program admin: theirs). */
export async function listBookablePrograms(ctx: SessionContext): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(and(isNull(programs.deletedAt), eq(programs.isActive, true)))
    .orderBy(asc(programs.name));
  return rows.filter((p) => canApproveBookings(ctx, p.id));
}
