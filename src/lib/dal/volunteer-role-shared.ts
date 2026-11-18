import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { programRoles, seasons, volunteerLogs, volunteerRoleAssignments, volunteerRoles } from "@/db/schema";
import { laDateInputToUtc } from "@/lib/format";
import { isBoard, type SessionContext } from "./context";
import { canManageProgram } from "./permissions";
import { laYearBounds } from "./volunteer-hours";

/**
 * Shared contract for the volunteer-roles workstreams (orchestrator-owned).
 * Terms: per_season roles use a season of the role's program; per_year roles use
 * an America/Los_Angeles calendar year.
 */

export type VolunteerRoleRow = typeof volunteerRoles.$inferSelect;
export type VolunteerRoleAssignmentRow = typeof volunteerRoleAssignments.$inferSelect;

/** Catalog management + approvals: program roles -> canManageProgram; org-wide -> board. */
export function canManageVolunteerRole(ctx: SessionContext, programId: string | null): boolean {
  return programId ? canManageProgram(ctx, programId) : isBoard(ctx);
}

export function termKeyForSeason(seasonId: string): string {
  return `season:${seasonId}`;
}
export function termKeyForYear(year: number): string {
  return `year:${year}`;
}

export interface TermBounds {
  /** Inclusive start / exclusive end in UTC; null when the season has no dates set. */
  start: Date | null;
  end: Date | null;
  label: string; // "Spring 2027" or "2026"
}

/** Bounds of a term. A season uses startsOn..endsOn (LA calendar days, inclusive). */
export async function getTermBounds(
  term: { seasonId: string | null; year: number | null },
  tx: DbOrTx = db
): Promise<TermBounds> {
  if (term.seasonId) {
    const [s] = await tx
      .select({ name: seasons.name, startsOn: seasons.startsOn, endsOn: seasons.endsOn })
      .from(seasons)
      .where(eq(seasons.id, term.seasonId))
      .limit(1);
    return {
      start: s?.startsOn ? laDateInputToUtc(s.startsOn, false) : null,
      end: s?.endsOn ? new Date(laDateInputToUtc(s.endsOn, true).getTime() + 1) : null,
      label: s?.name ?? "Season",
    };
  }
  const year = term.year as number;
  const { start, end } = laYearBounds(year);
  return { start, end, label: String(year) };
}

export interface AssignmentProgress {
  /** Minutes from live ledger rows that count for grants (shift check-in / admin approved). */
  verifiedMinutes: number;
  /** Minutes from live self-reported rows awaiting approval. */
  pendingMinutes: number;
}

/** Logged minutes per assignment (soft-deleted ledger rows excluded). */
export async function getAssignmentProgress(
  assignmentIds: string[],
  tx: DbOrTx = db
): Promise<Map<string, AssignmentProgress>> {
  const out = new Map<string, AssignmentProgress>();
  for (const id of assignmentIds) out.set(id, { verifiedMinutes: 0, pendingMinutes: 0 });
  if (assignmentIds.length === 0) return out;
  const rows = await tx
    .select({
      id: volunteerLogs.volunteerRoleAssignmentId,
      verified: sql<string>`coalesce(sum(${volunteerLogs.durationMinutes}) filter (where ${volunteerLogs.verificationMethod} <> 'self_reported'), 0)`,
      pending: sql<string>`coalesce(sum(${volunteerLogs.durationMinutes}) filter (where ${volunteerLogs.verificationMethod} = 'self_reported'), 0)`,
    })
    .from(volunteerLogs)
    .where(and(inArray(volunteerLogs.volunteerRoleAssignmentId, assignmentIds), isNull(volunteerLogs.deletedAt)))
    .groupBy(volunteerLogs.volunteerRoleAssignmentId);
  for (const r of rows) {
    if (r.id) out.set(r.id, { verifiedMinutes: Number(r.verified), pendingMinutes: Number(r.pending) });
  }
  return out;
}

/**
 * On approval of a role with grantsProgramRole: create the program_roles row
 * (season-scoped for per_season roles) unless an identical grant already exists,
 * in which case nothing is created or linked (so ending the assignment never
 * removes a grant someone made by hand). Returns the created id or null.
 */
export async function grantLinkedProgramRole(
  tx: DbOrTx,
  assignment: Pick<VolunteerRoleAssignmentRow, "userId" | "seasonId">,
  role: Pick<VolunteerRoleRow, "programId" | "grantsProgramRole">
): Promise<string | null> {
  if (!role.grantsProgramRole || !role.programId) return null;
  const existing = await tx
    .select({ id: programRoles.id })
    .from(programRoles)
    .where(
      and(
        eq(programRoles.userId, assignment.userId),
        eq(programRoles.programId, role.programId),
        eq(programRoles.role, role.grantsProgramRole),
        assignment.seasonId ? eq(programRoles.seasonId, assignment.seasonId) : isNull(programRoles.seasonId)
      )
    )
    .limit(1);
  if (existing.length) return null;
  const [row] = await tx
    .insert(programRoles)
    .values({
      userId: assignment.userId,
      programId: role.programId,
      seasonId: assignment.seasonId,
      role: role.grantsProgramRole,
    })
    .returning({ id: programRoles.id });
  return row.id;
}

/** On withdraw/end of an active assignment: remove the program_roles row it created, if any. */
export async function revokeLinkedProgramRole(
  tx: DbOrTx,
  assignment: Pick<VolunteerRoleAssignmentRow, "programRoleId">
): Promise<void> {
  if (!assignment.programRoleId) return;
  await tx.delete(programRoles).where(eq(programRoles.id, assignment.programRoleId));
}
