import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { programs } from "@/db/schema";
import { DalError, hasProgramRole, isBoard, type SessionContext } from "./context";

/**
 * Shared authorization rules for Sprint 2. Every DAL function must still call
 * these itself (layouts do not run for server actions).
 *
 * programId === null means an org-wide shift/entry, which only the board manages.
 */
export function canManageShifts(ctx: SessionContext, programId: string | null): boolean {
  if (isBoard(ctx)) return true;
  return programId !== null && hasProgramRole(ctx, programId, ["program_admin"]);
}

/** May open a shift roster and check volunteers in (kiosk / coordinator). */
export function canCheckIn(ctx: SessionContext, programId: string | null): boolean {
  if (canManageShifts(ctx, programId)) return true;
  return (
    programId !== null &&
    hasProgramRole(ctx, programId, ["head_coach", "team_manager"])
  );
}

/** Program ids where ctx may check volunteers in (board = all, returned as "all"). */
export function checkInProgramIds(ctx: SessionContext): "all" | string[] {
  if (isBoard(ctx)) return "all";
  return [
    ...new Set(
      ctx.programRoles
        .filter((g) => ["program_admin", "head_coach", "team_manager"].includes(g.role))
        .map((g) => g.programId)
    ),
  ];
}

/** Whether to show the coordinator "Manage shifts" nav entry. */
export function isShiftCoordinator(ctx: SessionContext): boolean {
  const ids = checkInProgramIds(ctx);
  return ids === "all" || ids.length > 0;
}

// ---- Sprint 3a: program staff ------------------------------------------------

export const PROGRAM_STAFF_ROLES = ["program_admin", "head_coach", "assistant_coach", "team_manager"] as const;

/** Create/edit seasons and waivers, record offline payments, cancel registrations. */
export function canManageProgram(ctx: SessionContext, programId: string): boolean {
  return isBoard(ctx) || hasProgramRole(ctx, programId, ["program_admin"]);
}

/** See the season roster and the (audited) team emergency sheet. */
export function canViewRoster(ctx: SessionContext, programId: string): boolean {
  return isBoard(ctx) || hasProgramRole(ctx, programId, [...PROGRAM_STAFF_ROLES]);
}

/** Programs where ctx holds a staff role ("all" for board). */
export function staffProgramIds(ctx: SessionContext): "all" | string[] {
  if (isBoard(ctx)) return "all";
  const staff: readonly string[] = PROGRAM_STAFF_ROLES;
  return [...new Set(ctx.programRoles.filter((g) => staff.includes(g.role)).map((g) => g.programId))];
}

/** Whether to show the "My programs" nav entry. */
export function isProgramStaff(ctx: SessionContext): boolean {
  const ids = staffProgramIds(ctx);
  return ids === "all" || ids.length > 0;
}

// ---- Admin & settings sprint ---------------------------------------------------

/** Org role changes (granting/revoking board or super admin) are super-admin only. */
export function isSuperAdmin(ctx: SessionContext): boolean {
  return ctx.orgRole === "super_admin";
}

/**
 * Inactive programs are reachable by the board only. Non-board staff get a
 * NOT_FOUND for an inactive (or missing) program, so existence stays hidden.
 */
export async function assertProgramReachable(
  ctx: SessionContext,
  programId: string,
  tx: DbOrTx = db
): Promise<void> {
  if (isBoard(ctx)) return;
  const [p] = await tx
    .select({ isActive: programs.isActive })
    .from(programs)
    .where(and(eq(programs.id, programId), isNull(programs.deletedAt)))
    .limit(1);
  if (!p?.isActive) throw new DalError("NOT_FOUND", "Program not found.");
}
