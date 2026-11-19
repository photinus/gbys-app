import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, programRoles, programRoleEnum, teamStaff, teams, teamStaffRoleEnum } from "@/db/schema";

export type OrgRole = "super_admin" | "board_member" | "member";
export type ProgramRole = (typeof programRoleEnum.enumValues)[number];

export interface ProgramRoleGrant {
  programId: string;
  seasonId: string | null;
  role: ProgramRole;
}

export interface SessionContext {
  userId: string;
  email: string;
  name: string;
  image: string | null;
  orgRole: OrgRole;
  programRoles: ProgramRoleGrant[];
  /** Live team staff assignments on active teams (team-scoped coach access). */
  teamStaff: TeamStaffGrant[];
}

export type TeamStaffRole = (typeof teamStaffRoleEnum.enumValues)[number];

export interface TeamStaffGrant {
  teamId: string;
  programId: string;
  seasonId: string;
  role: TeamStaffRole;
}

export class DalError extends Error {
  constructor(
    public code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID",
    message?: string
  ) {
    super(message ?? code);
    this.name = "DalError";
  }
}

/**
 * Resolves the current session to a fresh DB-backed context (role is re-read
 * from the DB on every request). Returns null when unauthenticated or when the
 * user is soft-deleted. Memoized per request via React cache().
 */
/**
 * Display avatar: an uploaded profile photo (served by /media/avatar/[userId],
 * versioned for caching) wins over the provider (Google) picture.
 */
export function avatarUrlFor(u: {
  id: string;
  image: string | null;
  avatarObjectKey: string | null;
  avatarUpdatedAt: Date | null;
}): string | null {
  if (u.avatarObjectKey && u.avatarUpdatedAt) return `/media/avatar/${u.id}?v=${u.avatarUpdatedAt.getTime()}`;
  return u.image ?? null;
}

export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, session.user.id), isNull(users.deletedAt)))
    .limit(1);
  if (!user) return null;

  const grants = await db
    .select({
      programId: programRoles.programId,
      seasonId: programRoles.seasonId,
      role: programRoles.role,
    })
    .from(programRoles)
    .where(eq(programRoles.userId, user.id));

  const teamGrants = await db
    .select({ teamId: teams.id, programId: teams.programId, seasonId: teams.seasonId, role: teamStaff.role })
    .from(teamStaff)
    .innerJoin(teams, eq(teams.id, teamStaff.teamId))
    .where(and(eq(teamStaff.userId, user.id), isNull(teamStaff.removedAt), eq(teams.isActive, true)));

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    image: avatarUrlFor(user),
    orgRole: user.orgRole,
    programRoles: grants,
    teamStaff: teamGrants,
  };
});

export async function requireSession(nextPath?: string): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) {
    redirect(nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in");
  }
  return ctx;
}

export async function requireOrgRole(...roles: OrgRole[]): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!roles.includes(ctx.orgRole)) {
    throw new DalError("FORBIDDEN", "You do not have permission to do that.");
  }
  return ctx;
}

export function isBoard(ctx: SessionContext): boolean {
  return ctx.orgRole === "super_admin" || ctx.orgRole === "board_member";
}

export function hasProgramRole(
  ctx: SessionContext,
  programId: string,
  roles?: ProgramRole[]
): boolean {
  return ctx.programRoles.some(
    (g) => g.programId === programId && (!roles || roles.includes(g.role))
  );
}

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Server-action wrapper: requires a session, runs `fn`, and converts DalError /
 * ZodError into `{ ok: false, error }`. Next.js control-flow errors (redirect,
 * notFound) are re-thrown; unexpected errors are logged and masked.
 */
export async function runAction<T>(
  fn: (ctx: SessionContext) => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const ctx = await requireSession();
    const data = await fn(ctx);
    return { ok: true, data };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof DalError) return { ok: false, error: err.message };
    if (err instanceof ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Invalid input." };
    }
    console.error("[runAction] unexpected error", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
