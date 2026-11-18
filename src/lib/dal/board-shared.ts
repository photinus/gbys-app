import "server-only";
import { and, asc, eq, gte, isNull, lte, or, gt } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { boardMembers } from "@/db/schema";
import { utcToLaDateInput } from "@/lib/format";
import { DalError, isBoard, type SessionContext } from "./context";

/** Shared contract for the Board of Directors workstreams (orchestrator-owned). */

export type BoardMemberRow = typeof boardMembers.$inferSelect;

export function requireBoardModule(ctx: SessionContext): void {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

/**
 * Seats that are voting directors at instant `at` (LA calendar date for term
 * bounds; endedAt compared as an instant). Ordered by position then name.
 */
export async function listSeatedDirectors(at: Date = new Date(), tx: DbOrTx = db): Promise<BoardMemberRow[]> {
  const day = utcToLaDateInput(at);
  return tx
    .select()
    .from(boardMembers)
    .where(
      and(
        eq(boardMembers.isVotingDirector, true),
        lte(boardMembers.termStart, day),
        or(isNull(boardMembers.termEnd), gte(boardMembers.termEnd, day)),
        or(isNull(boardMembers.endedAt), gt(boardMembers.endedAt, at))
      )
    )
    .orderBy(asc(boardMembers.position), asc(boardMembers.displayName));
}

/** The caller's seated voting seat at `at`, if any (votes require a linked account). */
export async function getMySeat(ctx: SessionContext, at: Date = new Date(), tx: DbOrTx = db): Promise<BoardMemberRow | null> {
  const seats = await listSeatedDirectors(at, tx);
  return seats.find((s) => s.userId === ctx.userId) ?? null;
}

/** Default quorum: a majority of seated voting directors. */
export function defaultQuorum(seatedCount: number): number {
  return Math.floor(seatedCount / 2) + 1;
}
