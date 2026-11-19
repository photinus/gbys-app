import "server-only";
import { sql } from "drizzle-orm";
import { type DbTx } from "@/db";
import { resourceBookings } from "@/db/schema";

/**
 * Facility booking engine (orchestrator-owned shared contract; invariant 8).
 *
 * - The facility tree is `resources.parentResourceId`. A booking on any node
 *   conflicts with APPROVED bookings on that node, all its ancestors and all
 *   its descendants (e.g. "Complex" blocks "Field A" and vice versa).
 * - Requests (`requested`) never block anything; approval re-checks.
 * - Every write that could create an approved booking must first call
 *   `lockFacilityTree(tx, resourceId)` in the SAME transaction: it takes a
 *   transaction-scoped advisory lock on the tree's root, so two concurrent
 *   approvals on overlapping nodes serialize and the second sees the first.
 */

export interface BookingConflict {
  id: string;
  resourceId: string;
  resourceName: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  programId: string | null;
}

/** Root resource id of the tree containing `resourceId` (itself if top-level). */
export async function facilityRootId(tx: DbTx, resourceId: string): Promise<string> {
  const rows = await tx.execute<{ id: string }>(sql`
    with recursive up as (
      select id, parent_resource_id, 0 as depth from resources where id = ${resourceId}
      union all
      select r.id, r.parent_resource_id, up.depth + 1
      from resources r join up on r.id = up.parent_resource_id
      where up.depth < 32
    )
    select id from up where parent_resource_id is null limit 1
  `);
  return rows.rows[0]?.id ?? resourceId;
}

/** Serialize booking approvals within one facility tree for this transaction. */
export async function lockFacilityTree(tx: DbTx, resourceId: string): Promise<void> {
  const root = await facilityRootId(tx, resourceId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"facility:" + root}))`);
}

/** Ids of the node, all ancestors and all descendants. */
export async function relatedResourceIds(tx: DbTx, resourceId: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    with recursive
      up as (
        select id, parent_resource_id, 0 as depth from resources where id = ${resourceId}
        union all
        select r.id, r.parent_resource_id, up.depth + 1
        from resources r join up on r.id = up.parent_resource_id
        where up.depth < 32
      ),
      down as (
        select id, 0 as depth from resources where id = ${resourceId}
        union all
        select r.id, down.depth + 1
        from resources r join down on r.parent_resource_id = down.id
        where down.depth < 32
      )
    select id from up union select id from down
  `);
  return rows.rows.map((r) => r.id);
}

/**
 * APPROVED bookings overlapping [startsAt, endsAt) on the node, its ancestors or
 * its descendants. Half-open intervals: back-to-back bookings don't conflict.
 */
export async function findBookingConflicts(
  tx: DbTx,
  args: { resourceId: string; startsAt: Date; endsAt: Date; excludeBookingId?: string }
): Promise<BookingConflict[]> {
  const ids = await relatedResourceIds(tx, args.resourceId);
  if (ids.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    resource_id: string;
    resource_name: string;
    title: string;
    starts_at: Date;
    ends_at: Date;
    program_id: string | null;
  }>(sql`
    select b.id, b.resource_id, r.name as resource_name, b.title, b.starts_at, b.ends_at, b.program_id
    from resource_bookings b
    join resources r on r.id = b.resource_id
    where b.status = 'approved'
      and b.resource_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
      and b.starts_at < ${args.endsAt}
      and b.ends_at > ${args.startsAt}
      ${args.excludeBookingId ? sql`and b.id <> ${args.excludeBookingId}::uuid` : sql``}
    order by b.starts_at
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    resourceId: r.resource_id,
    resourceName: r.resource_name,
    title: r.title,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    programId: r.program_id,
  }));
}

export interface InsertBookingInput {
  resourceId: string;
  programId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  createdByUserId: string;
  seriesId?: string | null;
  notes?: string | null;
  /** Caller already verified canApproveBookings: create as approved (direct booking). */
  autoApprove: boolean;
}

export type InsertBookingResult =
  | { ok: true; bookingId: string; status: "requested" | "approved" }
  | { ok: false; conflicts: BookingConflict[] };

/**
 * Insert a booking inside the caller's transaction. Always locks the tree and
 * refuses (ok:false) if it overlaps an APPROVED booking — a request that could
 * never be approved is pointless. With autoApprove the row is created approved.
 * The caller writes the audit row ("booking.requested" / "booking.created").
 */
export async function insertBooking(tx: DbTx, input: InsertBookingInput): Promise<InsertBookingResult> {
  await lockFacilityTree(tx, input.resourceId);
  const conflicts = await findBookingConflicts(tx, input);
  if (conflicts.length) return { ok: false, conflicts };
  const now = new Date();
  const status = input.autoApprove ? ("approved" as const) : ("requested" as const);
  const [row] = await tx
    .insert(resourceBookings)
    .values({
      resourceId: input.resourceId,
      programId: input.programId,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdByUserId: input.createdByUserId,
      seriesId: input.seriesId ?? null,
      notes: input.notes ?? null,
      status,
      ...(input.autoApprove ? { decidedByUserId: input.createdByUserId, decidedAt: now } : {}),
    })
    .returning({ id: resourceBookings.id });
  return { ok: true, bookingId: row.id, status };
}
