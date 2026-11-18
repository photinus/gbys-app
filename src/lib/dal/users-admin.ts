import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  athletes,
  auditLogs,
  credentialDefinitions,
  householdGuardians,
  programRoles,
  programs,
  sessions,
  userCredentials,
  users,
  volunteerLogs,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { inKindValueCents } from "@/lib/grant-rate";
import {
  USER_PAGE_SIZE,
  deactivateReasonSchema,
  listUsersSchema,
  orgRoleSchema,
  profileAdminSchema,
  userIdSchema,
  type ListUsersInput,
  type OrgRoleValue,
  type ProfileAdminInput,
} from "@/lib/validation/users-admin";
import { DalError, isBoard, type ProgramRole, type SessionContext } from "./context";
import { isSuperAdmin } from "./permissions";
import { getInKindRateCents } from "./settings";
import { laYearBounds, laYearOf } from "./volunteer-hours";

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

export type CredentialStatus = (typeof userCredentials.$inferSelect)["status"];

export interface UserListRow {
  id: string;
  name: string;
  email: string;
  orgRole: OrgRoleValue;
  isActive: boolean;
  createdAt: Date;
  lastSignInAt: Date | null;
  programRoleCount: number;
  verifiedCredentialCount: number;
  emailBounced: boolean;
}

export interface UserListResult {
  rows: UserListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listUsers(ctx: SessionContext, input: ListUsersInput = {}): Promise<UserListResult> {
  requireBoard(ctx);
  const f = listUsersSchema.parse(input);

  const conds: (SQL | undefined)[] = [];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conds.push(or(sql`${users.name} ILIKE ${like}`, sql`${users.email} ILIKE ${like}`));
  }
  if (f.role !== "all") conds.push(eq(users.orgRole, f.role));
  if (f.status === "active") conds.push(isNull(users.deletedAt));
  if (f.status === "deactivated") conds.push(sql`${users.deletedAt} IS NOT NULL`);
  if (f.bounced) conds.push(eq(users.emailBounced, true));
  const where = conds.length ? and(...conds) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(users).where(where);
  const pageCount = Math.max(1, Math.ceil(total / USER_PAGE_SIZE));
  const page = Math.min(f.page, pageCount);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      orgRole: users.orgRole,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
      emailBounced: users.emailBounced,
      lastSignInAt: sql<Date | null>`(select max(${sessions.createdAt}) from ${sessions} where ${sessions.userId} = "users"."id")`.mapWith(
        (v) => (v == null ? null : new Date(v))
      ),
      programRoleCount: sql<number>`(select count(*) from ${programRoles} where ${programRoles.userId} = "users"."id")`.mapWith(Number),
      verifiedCredentialCount: sql<number>`(select count(*) from ${userCredentials} where ${userCredentials.userId} = "users"."id" and ${userCredentials.status} = 'verified' and (${userCredentials.expiresAt} is null or ${userCredentials.expiresAt} > now()))`.mapWith(
        Number
      ),
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(USER_PAGE_SIZE)
    .offset((page - 1) * USER_PAGE_SIZE);

  return {
    rows: rows.map(({ deletedAt, ...r }) => ({ ...r, isActive: !deletedAt })),
    total,
    page,
    pageSize: USER_PAGE_SIZE,
    pageCount,
  };
}

// ---------------------------------------------------------------------------
// Detail (no athlete names, no medical data, no proof URLs)
// ---------------------------------------------------------------------------
export interface UserAdminDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  smsOptIn: boolean;
  emailBounced: boolean;
  orgRole: OrgRoleValue;
  isActive: boolean;
  createdAt: Date;
  deactivatedAt: Date | null;
  isSelf: boolean;
  /** Whether the viewer may change this user's org role (super admin, not self, target active). */
  canChangeRole: boolean;
  /** Whether the viewer may deactivate this user. */
  canDeactivate: boolean;
  /** Whether the viewer may restore this user. */
  canRestore: boolean;
  programRoles: { id: string; programId: string; programName: string; role: ProgramRole }[];
  credentials: { id: string; typeName: string; status: CredentialStatus; expiresAt: Date | null }[];
  hours: { year: number; verifiedMinutes: number; verifiedValueCents: number };
  /** Counts only: no names, no medical data. */
  household: { athleteCount: number; soleGuardianAthleteCount: number };
  activity: {
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    actorUserId: string | null;
    actorName: string | null;
    createdAt: Date;
    role: "actor" | "target";
  }[];
}

/** Whether `ctx` may deactivate/restore a user currently holding `targetRole`. */
function canActOnRole(ctx: SessionContext, targetRole: OrgRoleValue): boolean {
  if (targetRole === "member") return true;
  return isSuperAdmin(ctx);
}

export async function getUserAdmin(ctx: SessionContext, userId: string): Promise<UserAdminDetail> {
  requireBoard(ctx);
  const id = userIdSchema.parse(userId);
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      smsOptIn: users.smsOptIn,
      emailBounced: users.emailBounced,
      orgRole: users.orgRole,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!u) throw new DalError("NOT_FOUND", "User not found.");

  const year = laYearOf(new Date());
  const { start, end } = laYearBounds(year);

  const [roles, creds, logs, rate, hh, activity] = await Promise.all([
    db
      .select({
        id: programRoles.id,
        programId: programRoles.programId,
        programName: programs.name,
        role: programRoles.role,
      })
      .from(programRoles)
      .innerJoin(programs, eq(programs.id, programRoles.programId))
      .where(eq(programRoles.userId, id))
      .orderBy(programs.name),
    db
      .select({
        id: userCredentials.id,
        typeName: credentialDefinitions.name,
        status: userCredentials.status,
        expiresAt: userCredentials.expiresAt,
      })
      .from(userCredentials)
      .innerJoin(credentialDefinitions, eq(credentialDefinitions.id, userCredentials.definitionId))
      .where(eq(userCredentials.userId, id))
      .orderBy(desc(userCredentials.createdAt)),
    db
      .select({ minutes: volunteerLogs.durationMinutes, rate: volunteerLogs.inKindRateCents })
      .from(volunteerLogs)
      .where(
        and(
          eq(volunteerLogs.userId, id),
          isNull(volunteerLogs.deletedAt),
          ne(volunteerLogs.verificationMethod, "self_reported"),
          gte(volunteerLogs.activityDate, start),
          lt(volunteerLogs.activityDate, end)
        )
      ),
    getInKindRateCents(),
    householdCounts(id),
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        targetType: auditLogs.targetType,
        targetId: auditLogs.targetId,
        actorUserId: auditLogs.actorUserId,
        actorName: users.name,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(or(eq(auditLogs.actorUserId, id), and(eq(auditLogs.targetType, "user"), eq(auditLogs.targetId, id))))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(20),
  ]);

  let verifiedMinutes = 0;
  let verifiedValueCents = 0;
  for (const l of logs) {
    verifiedMinutes += l.minutes;
    verifiedValueCents += inKindValueCents(l.minutes, l.rate ?? rate);
  }

  const isSelf = u.id === ctx.userId;
  const active = !u.deletedAt;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    smsOptIn: u.smsOptIn,
    emailBounced: u.emailBounced,
    orgRole: u.orgRole,
    isActive: active,
    createdAt: u.createdAt,
    deactivatedAt: u.deletedAt,
    isSelf,
    canChangeRole: isSuperAdmin(ctx) && !isSelf && active,
    canDeactivate: active && !isSelf && canActOnRole(ctx, u.orgRole),
    canRestore: !active && canActOnRole(ctx, u.orgRole),
    programRoles: roles,
    credentials: creds,
    hours: { year, verifiedMinutes, verifiedValueCents },
    household: hh,
    activity: activity.map((a) => ({
      ...a,
      role: a.actorUserId === id ? ("actor" as const) : ("target" as const),
    })),
  };
}

/** Counts only. soleGuardian = live athletes whose only active guardian is this user. */
async function householdCounts(userId: string): Promise<{ athleteCount: number; soleGuardianAthleteCount: number }> {
  const mine = await db
    .select({ athleteId: householdGuardians.athleteId })
    .from(householdGuardians)
    .innerJoin(athletes, eq(athletes.id, householdGuardians.athleteId))
    .where(and(eq(householdGuardians.userId, userId), isNull(athletes.deletedAt)));
  const ids = mine.map((m) => m.athleteId);
  if (ids.length === 0) return { athleteCount: 0, soleGuardianAthleteCount: 0 };
  const [{ n }] = await db
    .select({ n: count() })
    .from(athletes)
    .where(
      and(
        inArray(athletes.id, ids),
        sql`not exists (select 1 from ${householdGuardians} g inner join ${users} gu on gu.id = g.user_id where g.athlete_id = ${athletes.id} and g.user_id <> ${userId} and gu.deleted_at is null)`
      )
    );
  return { athleteCount: ids.length, soleGuardianAthleteCount: Number(n) };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks every ACTIVE super-admin row (ordered by id, so concurrent writers queue
 * rather than deadlock). Under READ COMMITTED a waiter re-checks the WHERE clause
 * once the first writer commits, so a super admin demoted meanwhile drops out of
 * the returned set: two super admins demoting each other can never both succeed.
 */
async function lockActiveSuperAdmins(tx: Tx): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgRole, "super_admin"), isNull(users.deletedAt)))
    .orderBy(users.id)
    .for("update");
  return rows.map((r) => r.id);
}

async function lockUser(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: users.id,
      orgRole: users.orgRole,
      deletedAt: users.deletedAt,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, id))
    .for("update");
  return row;
}

export async function changeOrgRole(ctx: SessionContext, userId: string, role: string): Promise<void> {
  if (!isSuperAdmin(ctx)) throw new DalError("FORBIDDEN", "Only super admins can change roles.");
  const id = userIdSchema.parse(userId);
  const newRole = orgRoleSchema.parse(role);
  if (id === ctx.userId) throw new DalError("FORBIDDEN", "You can't change your own role.");

  await db.transaction(async (tx) => {
    const superAdmins = await lockActiveSuperAdmins(tx);
    // Re-verify the actor under the lock (their role may have changed since the request began).
    if (!superAdmins.includes(ctx.userId)) {
      throw new DalError("FORBIDDEN", "Only super admins can change roles.");
    }
    const target = await lockUser(tx, id);
    if (!target) throw new DalError("NOT_FOUND", "User not found.");
    if (target.deletedAt) throw new DalError("INVALID", "Restore this user before changing their role.");
    if (target.orgRole === newRole) throw new DalError("INVALID", "That is already their role.");
    if (target.orgRole === "super_admin" && superAdmins.filter((s) => s !== id).length === 0) {
      throw new DalError("INVALID", "You can't demote the last active super admin.");
    }
    await tx.update(users).set({ orgRole: newRole }).where(eq(users.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "user.role_changed",
        targetType: "user",
        targetId: id,
        metadata: { from: target.orgRole, to: newRole },
      },
      tx
    );
  });
}

export async function updateUserProfileAdmin(
  ctx: SessionContext,
  userId: string,
  input: ProfileAdminInput
): Promise<void> {
  requireBoard(ctx);
  const id = userIdSchema.parse(userId);
  const data = profileAdminSchema.parse(input);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: users.name, phone: users.phone })
      .from(users)
      .where(eq(users.id, id))
      .for("update");
    if (!before) throw new DalError("NOT_FOUND", "User not found.");
    const changed: string[] = [];
    if (before.name !== data.name) changed.push("name");
    if ((before.phone ?? null) !== data.phone) changed.push("phone");
    if (changed.length === 0) return;
    await tx.update(users).set({ name: data.name, phone: data.phone }).where(eq(users.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "user.profile_updated",
        targetType: "user",
        targetId: id,
        metadata: { fields: changed },
      },
      tx
    );
  });
}

export async function deactivateUser(ctx: SessionContext, userId: string, reason: string): Promise<void> {
  requireBoard(ctx);
  const id = userIdSchema.parse(userId);
  const why = deactivateReasonSchema.parse(reason);
  if (id === ctx.userId) throw new DalError("FORBIDDEN", "You can't deactivate yourself.");

  await db.transaction(async (tx) => {
    const superAdmins = await lockActiveSuperAdmins(tx);
    const actor = await lockUser(tx, ctx.userId);
    if (!actor || actor.deletedAt || (actor.orgRole !== "super_admin" && actor.orgRole !== "board_member")) {
      throw new DalError("FORBIDDEN", "You do not have permission to do that.");
    }
    const target = await lockUser(tx, id);
    if (!target) throw new DalError("NOT_FOUND", "User not found.");
    if (target.deletedAt) throw new DalError("INVALID", "This user is already deactivated.");
    if (target.orgRole !== "member" && actor.orgRole !== "super_admin") {
      throw new DalError("FORBIDDEN", "Only super admins can deactivate a board member or super admin.");
    }
    if (target.orgRole === "super_admin" && superAdmins.filter((s) => s !== id).length === 0) {
      throw new DalError("INVALID", "You can't deactivate the last active super admin.");
    }
    await tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id));
    const killed = await tx.delete(sessions).where(eq(sessions.userId, id)).returning({ id: sessions.id });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "user.deactivated",
        targetType: "user",
        targetId: id,
        metadata: { reason: why, sessionsRevoked: killed.length },
      },
      tx
    );
  });
}

export async function restoreUser(ctx: SessionContext, userId: string): Promise<void> {
  requireBoard(ctx);
  const id = userIdSchema.parse(userId);
  await db.transaction(async (tx) => {
    await lockActiveSuperAdmins(tx); // same lock order as deactivateUser (avoids deadlocks)
    const actor = await lockUser(tx, ctx.userId);
    if (!actor || actor.deletedAt || (actor.orgRole !== "super_admin" && actor.orgRole !== "board_member")) {
      throw new DalError("FORBIDDEN", "You do not have permission to do that.");
    }
    const target = await lockUser(tx, id);
    if (!target) throw new DalError("NOT_FOUND", "User not found.");
    if (!target.deletedAt) throw new DalError("INVALID", "This user is already active.");
    if (target.orgRole !== "member" && actor.orgRole !== "super_admin") {
      throw new DalError("FORBIDDEN", "Only super admins can restore a board member or super admin.");
    }
    await tx.update(users).set({ deletedAt: null }).where(eq(users.id, id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "user.restored", targetType: "user", targetId: id },
      tx
    );
  });
}
