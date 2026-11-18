import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import { db, type DbOrTx } from "@/db";
import {
  credentialDefinitions,
  programs,
  seasons,
  userCredentials,
  users,
  volunteerRoleAssignments,
  volunteerRoles,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { utcToLaDateInput } from "@/lib/format";
import type { AssignmentStatus, VolunteerRolePeriod } from "@/lib/volunteer-roles";
import type { VolunteerCategory } from "@/lib/volunteer-categories";
import {
  assignInputSchema,
  noteSchema,
  reasonSchema,
  roleInputSchema,
  type AssignInput,
  type RoleInput,
} from "@/lib/validation/volunteer-roles";
import { DalError, isBoard, type ProgramRole, type SessionContext } from "./context";
import { assertProgramReachable, canViewRoster } from "./permissions";
import {
  canManageVolunteerRole,
  getAssignmentProgress,
  grantLinkedProgramRole,
  revokeLinkedProgramRole,
  termKeyForSeason,
  termKeyForYear,
  type AssignmentProgress,
} from "./volunteer-role-shared";
import { laYearOf } from "./volunteer-hours";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const forbidden = () => new DalError("FORBIDDEN", "You do not have permission to do that.");

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DalError("INVALID", r.error.issues[0]?.message ?? "Invalid input.");
  return r.data;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function parseId(id: string, what: string): string {
  if (typeof id !== "string" || !uuidRe.test(id)) throw new DalError("NOT_FOUND", `${what} not found.`);
  return id;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoleScope = { programId: string } | { orgWide: true } | { all: true };

export interface ManagedRole {
  id: string;
  programId: string | null;
  programName: string | null;
  programSlug: string | null;
  name: string;
  description: string | null;
  category: VolunteerCategory;
  period: VolunteerRolePeriod;
  expectedMinutes: number;
  slots: number | null;
  requiresApproval: boolean;
  grantsProgramRole: ProgramRole | null;
  requiredCredentialIds: string[];
  requiredCredentialNames: string[];
  isActive: boolean;
  canManage: boolean;
  /** Live (pending + active) assignments across all terms: locks period / program / permission edits. */
  liveCount: number;
  /** Counts across current terms (seasons not ended, this LA year onward). */
  activeCount: number;
  pendingCount: number;
  /** Most live assignments in any single current term (slots are per term). */
  slotsUsed: number;
}

export interface CredentialReadiness {
  id: string;
  name: string;
  ok: boolean;
}

export interface ReviewRow {
  id: string;
  roleId: string;
  roleName: string;
  programId: string | null;
  programName: string | null;
  programSlug: string | null;
  period: VolunteerRolePeriod;
  grantsProgramRole: ProgramRole | null;
  userId: string;
  userName: string;
  /** Shown to managers only. */
  userEmail: string | null;
  termKey: string;
  termLabel: string;
  status: AssignmentStatus;
  signupNote: string | null;
  signedUpAt: Date;
  decidedAt: Date | null;
  decidedByName: string | null;
  decisionNote: string | null;
  endedAt: Date | null;
  endedByName: string | null;
  endReason: string | null;
  expectedMinutes: number;
  progress: AssignmentProgress;
  credentials: CredentialReadiness[];
  missingCredentialCount: number;
  canManage: boolean;
  /** The signed-in user's own sign-up (cannot be approved by themselves for a granting role). */
  isSelf: boolean;
  /** Own sign-up for a permission-granting role and ctx is not board: another manager must approve. */
  selfApprovalBlocked: boolean;
}

export interface RoleCredentialOption {
  id: string;
  name: string;
  archived?: boolean;
}

export interface TermOptions {
  seasons: { id: string; name: string }[];
  currentYear: number;
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

async function loadProgram(ctx: SessionContext, programId: string) {
  parseId(programId, "Program");
  const [p] = await db
    .select({ id: programs.id, slug: programs.slug, name: programs.name, isActive: programs.isActive })
    .from(programs)
    .where(and(eq(programs.id, programId), isNull(programs.deletedAt)))
    .limit(1);
  if (!p || (!p.isActive && !isBoard(ctx))) throw new DalError("NOT_FOUND", "Program not found.");
  return p;
}

/** Viewing needs program staff (or board); org-wide / all scopes are board-only. */
async function authorizeScope(ctx: SessionContext, scope: RoleScope) {
  if ("programId" in scope) {
    await loadProgram(ctx, scope.programId);
    if (!canViewRoster(ctx, scope.programId)) throw forbidden();
    return;
  }
  if (!isBoard(ctx)) throw forbidden();
}

function scopeCondition(scope: RoleScope) {
  if ("programId" in scope) return eq(volunteerRoles.programId, scope.programId);
  if ("orgWide" in scope) return isNull(volunteerRoles.programId);
  return sql`true`;
}

function laToday(): string {
  return utcToLaDateInput(new Date());
}

/** A term is "current" while its season hasn't ended, or its year is this LA year or later. */
function isCurrentTerm(
  t: { seasonId: string | null; year: number | null; seasonEndsOn: string | null; seasonActive: boolean | null },
  today: string,
  currentYear: number
): boolean {
  if (t.seasonId) return !!t.seasonActive && (t.seasonEndsOn === null || t.seasonEndsOn >= today);
  return (t.year ?? 0) >= currentYear;
}

// ---------------------------------------------------------------------------
// Program context for pages
// ---------------------------------------------------------------------------

export async function getProgramForRoles(ctx: SessionContext, slug: string) {
  const [program] = await db
    .select({ id: programs.id, slug: programs.slug, name: programs.name, sport: programs.sport, isActive: programs.isActive })
    .from(programs)
    .where(and(eq(programs.slug, slug), isNull(programs.deletedAt)))
    .limit(1);
  if (!program || (!program.isActive && !isBoard(ctx))) throw new DalError("NOT_FOUND", "Program not found.");
  if (!canViewRoster(ctx, program.id)) throw forbidden();
  return { program, canManage: canManageVolunteerRole(ctx, program.id) };
}

/** Small summary for the program hub card. */
export async function getProgramRoleSummary(
  ctx: SessionContext,
  programId: string
): Promise<{ activeRoles: number; pendingSignups: number }> {
  await authorizeScope(ctx, { programId });
  const [r] = await db
    .select({
      activeRoles: sql<number>`count(*) filter (where ${volunteerRoles.isActive})`.mapWith(Number),
      pendingSignups: sql<number>`coalesce(sum((select count(*) from ${volunteerRoleAssignments} a where a.role_id = volunteer_roles.id and a.status = 'pending')), 0)`.mapWith(Number),
    })
    .from(volunteerRoles)
    .where(eq(volunteerRoles.programId, programId));
  return { activeRoles: r?.activeRoles ?? 0, pendingSignups: r?.pendingSignups ?? 0 };
}

/** Seasons a manager may assign into (active, not ended) plus the LA year, for the assign modal. */
export async function getRoleTermOptions(ctx: SessionContext, programId: string | null): Promise<TermOptions> {
  const currentYear = laYearOf(new Date());
  if (programId === null) {
    if (!isBoard(ctx)) throw forbidden();
    return { seasons: [], currentYear };
  }
  await authorizeScope(ctx, { programId });
  const today = laToday();
  const rows = await db
    .select({ id: seasons.id, name: seasons.name })
    .from(seasons)
    .where(
      and(
        eq(seasons.programId, programId),
        eq(seasons.isActive, true),
        or(isNull(seasons.endsOn), sql`${seasons.endsOn} >= ${today}`)
      )
    )
    .orderBy(asc(seasons.startsOn), asc(seasons.createdAt));
  return { seasons: rows, currentYear };
}

/**
 * Credential types for a role's required-credentials picker (active ones, plus archived
 * types the role already requires). Anyone who may manage the scope can read them.
 */
export async function listRoleCredentialOptions(
  ctx: SessionContext,
  programId: string | null,
  alreadyRequired: string[] = []
): Promise<RoleCredentialOption[]> {
  if (programId === null ? !isBoard(ctx) : !canViewRoster(ctx, parseId(programId, "Program"))) throw forbidden();
  const rows = await db
    .select({ id: credentialDefinitions.id, name: credentialDefinitions.name, isActive: credentialDefinitions.isActive })
    .from(credentialDefinitions)
    .orderBy(asc(credentialDefinitions.name));
  return rows
    .filter((r) => r.isActive || alreadyRequired.includes(r.id))
    .map((r) => (r.isActive ? { id: r.id, name: r.name } : { id: r.id, name: r.name, archived: true }));
}

// ---------------------------------------------------------------------------
// Role catalog
// ---------------------------------------------------------------------------

export async function listManagedRoles(ctx: SessionContext, scope: RoleScope): Promise<ManagedRole[]> {
  await authorizeScope(ctx, scope);

  const roles = await db
    .select({
      id: volunteerRoles.id,
      programId: volunteerRoles.programId,
      programName: programs.name,
      programSlug: programs.slug,
      name: volunteerRoles.name,
      description: volunteerRoles.description,
      category: volunteerRoles.category,
      period: volunteerRoles.period,
      expectedMinutes: volunteerRoles.expectedMinutes,
      slots: volunteerRoles.slots,
      requiresApproval: volunteerRoles.requiresApproval,
      grantsProgramRole: volunteerRoles.grantsProgramRole,
      requiredCredentialIds: volunteerRoles.requiredCredentialIds,
      isActive: volunteerRoles.isActive,
    })
    .from(volunteerRoles)
    .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
    .where(scopeCondition(scope))
    .orderBy(asc(programs.name), desc(volunteerRoles.isActive), asc(volunteerRoles.name));
  if (roles.length === 0) return [];

  const roleIds = roles.map((r) => r.id);
  const live = await db
    .select({
      roleId: volunteerRoleAssignments.roleId,
      termKey: volunteerRoleAssignments.termKey,
      status: volunteerRoleAssignments.status,
      seasonId: volunteerRoleAssignments.seasonId,
      year: volunteerRoleAssignments.year,
      seasonEndsOn: seasons.endsOn,
      seasonActive: seasons.isActive,
    })
    .from(volunteerRoleAssignments)
    .leftJoin(seasons, eq(seasons.id, volunteerRoleAssignments.seasonId))
    .where(
      and(inArray(volunteerRoleAssignments.roleId, roleIds), inArray(volunteerRoleAssignments.status, ["pending", "active"]))
    );

  const today = laToday();
  const currentYear = laYearOf(new Date());
  const agg = new Map<string, { live: number; active: number; pending: number; perTerm: Map<string, number> }>();
  for (const a of live) {
    const g = agg.get(a.roleId) ?? { live: 0, active: 0, pending: 0, perTerm: new Map() };
    g.live += 1;
    if (isCurrentTerm(a, today, currentYear)) {
      if (a.status === "active") g.active += 1;
      else g.pending += 1;
      g.perTerm.set(a.termKey, (g.perTerm.get(a.termKey) ?? 0) + 1);
    }
    agg.set(a.roleId, g);
  }

  const credNames = await credentialNameMap(roles.flatMap((r) => r.requiredCredentialIds));

  return roles.map((r) => {
    const g = agg.get(r.id);
    return {
      ...r,
      requiredCredentialNames: r.requiredCredentialIds.map((id) => credNames.get(id) ?? "Unknown credential"),
      canManage: canManageVolunteerRole(ctx, r.programId),
      liveCount: g?.live ?? 0,
      activeCount: g?.active ?? 0,
      pendingCount: g?.pending ?? 0,
      slotsUsed: g ? Math.max(0, ...g.perTerm.values()) : 0,
    };
  });
}

async function credentialNameMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: credentialDefinitions.id, name: credentialDefinitions.name })
    .from(credentialDefinitions)
    .where(inArray(credentialDefinitions.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Rejects archived/unknown credential types (types the role already requires stay allowed). */
async function validateCredentialIds(ids: string[], alreadyRequired: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: credentialDefinitions.id, isActive: credentialDefinitions.isActive })
    .from(credentialDefinitions)
    .where(inArray(credentialDefinitions.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.isActive]));
  for (const id of ids) {
    if (!byId.has(id)) throw new DalError("INVALID", "One of the required credentials no longer exists.");
    if (!byId.get(id) && !alreadyRequired.includes(id)) {
      throw new DalError("INVALID", "Archived credential types can't be newly required.");
    }
  }
}

/** Only the board may attach (or detach) program_admin: a program admin must not mint program admins. */
function assertMayChangeGrant(ctx: SessionContext, before: ProgramRole | null, after: ProgramRole | null) {
  if (before === after) return;
  if ((before === "program_admin" || after === "program_admin") && !isBoard(ctx)) {
    throw new DalError("FORBIDDEN", "Only the board can set a role to grant Program admin access.");
  }
}

export async function createRole(ctx: SessionContext, input: RoleInput): Promise<{ id: string }> {
  const data = parseInput(roleInputSchema, input);
  if (!canManageVolunteerRole(ctx, data.programId)) throw forbidden();
  if (data.programId) await loadProgram(ctx, data.programId);
  assertMayChangeGrant(ctx, null, data.grantsProgramRole);
  await validateCredentialIds(data.requiredCredentialIds, []);

  const [row] = await db
    .insert(volunteerRoles)
    .values({
      programId: data.programId,
      name: data.name,
      description: data.description,
      category: data.category,
      period: data.period,
      expectedMinutes: data.expectedMinutes,
      slots: data.slots,
      requiresApproval: data.requiresApproval,
      grantsProgramRole: data.grantsProgramRole,
      requiredCredentialIds: data.requiredCredentialIds,
      createdByUserId: ctx.userId,
    })
    .returning({ id: volunteerRoles.id });
  await writeAudit({
    actorUserId: ctx.userId,
    action: "volunteer_role.created",
    targetType: "volunteer_role",
    targetId: row.id,
    metadata: {
      name: data.name,
      programId: data.programId,
      period: data.period,
      expectedMinutes: data.expectedMinutes,
      slots: data.slots,
      requiresApproval: data.requiresApproval,
      grantsProgramRole: data.grantsProgramRole,
    },
  });
  return row;
}

export async function updateRole(ctx: SessionContext, id: string, input: RoleInput): Promise<void> {
  parseId(id, "Role");
  const data = parseInput(roleInputSchema, input);

  await db.transaction(async (tx) => {
    // Role lock first (same order as sign-up / approve) so live counts can't change under us.
    const [role] = await tx.select().from(volunteerRoles).where(eq(volunteerRoles.id, id)).for("update").limit(1);
    if (!role) throw new DalError("NOT_FOUND", "Role not found.");
    if (!canManageVolunteerRole(ctx, role.programId)) throw forbidden();
    if (role.programId) await assertProgramReachable(ctx, role.programId, tx);

    if (data.programId !== role.programId) {
      throw new DalError("INVALID", "A role can't be moved to a different program. Archive it and create a new one.");
    }
    assertMayChangeGrant(ctx, role.grantsProgramRole, data.grantsProgramRole);

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(volunteerRoleAssignments)
      .where(and(eq(volunteerRoleAssignments.roleId, id), inArray(volunteerRoleAssignments.status, ["pending", "active"])));
    if (n > 0 && data.period !== role.period) {
      throw new DalError("INVALID", "The period can't change while volunteers have pending or active sign-ups. End or decline them first.");
    }
    if (n > 0 && data.grantsProgramRole !== role.grantsProgramRole) {
      throw new DalError("INVALID", "The permission this role grants can't change while volunteers have pending or active sign-ups. End or decline them first.");
    }
    await validateCredentialIds(data.requiredCredentialIds, role.requiredCredentialIds);

    const next = {
      name: data.name,
      description: data.description,
      category: data.category,
      period: data.period,
      expectedMinutes: data.expectedMinutes,
      slots: data.slots,
      requiresApproval: data.requiresApproval,
      grantsProgramRole: data.grantsProgramRole,
      requiredCredentialIds: data.requiredCredentialIds,
    };
    // Expected hours change applies to new activations only: existing assignments keep their snapshot.
    await tx.update(volunteerRoles).set(next).where(eq(volunteerRoles.id, id));

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      if (JSON.stringify(role[k]) !== JSON.stringify(next[k])) changed[k] = { from: role[k], to: next[k] };
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "volunteer_role.updated",
        targetType: "volunteer_role",
        targetId: id,
        metadata: { programId: role.programId, changed },
      },
      tx
    );
  });
}

async function setRoleActive(ctx: SessionContext, id: string, isActive: boolean): Promise<void> {
  parseId(id, "Role");
  await db.transaction(async (tx) => {
    const [role] = await tx
      .select({ id: volunteerRoles.id, programId: volunteerRoles.programId, isActive: volunteerRoles.isActive, name: volunteerRoles.name })
      .from(volunteerRoles)
      .where(eq(volunteerRoles.id, id))
      .for("update")
      .limit(1);
    if (!role) throw new DalError("NOT_FOUND", "Role not found.");
    if (!canManageVolunteerRole(ctx, role.programId)) throw forbidden();
    if (role.programId) await assertProgramReachable(ctx, role.programId, tx);
    if (role.isActive === isActive) {
      throw new DalError("INVALID", isActive ? "This role is already active." : "This role is already archived.");
    }
    await tx.update(volunteerRoles).set({ isActive }).where(eq(volunteerRoles.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: isActive ? "volunteer_role.restored" : "volunteer_role.archived",
        targetType: "volunteer_role",
        targetId: id,
        metadata: { name: role.name, programId: role.programId },
      },
      tx
    );
  });
}

/** An archived role takes no new sign-ups; existing assignments are left alone. */
export const archiveRole = (ctx: SessionContext, id: string) => setRoleActive(ctx, id, false);
export const restoreRole = (ctx: SessionContext, id: string) => setRoleActive(ctx, id, true);

// ---------------------------------------------------------------------------
// Sign-ups review
// ---------------------------------------------------------------------------

export async function listAssignmentsForReview(
  ctx: SessionContext,
  opts: { scope: RoleScope; status?: AssignmentStatus; termKey?: string }
): Promise<ReviewRow[]> {
  await authorizeScope(ctx, opts.scope);

  const decider = alias(users, "decider");
  const ender = alias(users, "ender");
  const conds = [scopeCondition(opts.scope)];
  if (opts.status) conds.push(eq(volunteerRoleAssignments.status, opts.status));
  if (opts.termKey) conds.push(eq(volunteerRoleAssignments.termKey, opts.termKey));

  const rows = await db
    .select({
      id: volunteerRoleAssignments.id,
      roleId: volunteerRoles.id,
      roleName: volunteerRoles.name,
      programId: volunteerRoles.programId,
      programName: programs.name,
      programSlug: programs.slug,
      period: volunteerRoles.period,
      grantsProgramRole: volunteerRoles.grantsProgramRole,
      roleExpectedMinutes: volunteerRoles.expectedMinutes,
      requiredCredentialIds: volunteerRoles.requiredCredentialIds,
      userId: volunteerRoleAssignments.userId,
      userName: users.name,
      userEmail: users.email,
      termKey: volunteerRoleAssignments.termKey,
      year: volunteerRoleAssignments.year,
      seasonName: seasons.name,
      status: volunteerRoleAssignments.status,
      signupNote: volunteerRoleAssignments.signupNote,
      signedUpAt: volunteerRoleAssignments.signedUpAt,
      decidedAt: volunteerRoleAssignments.decidedAt,
      decidedByName: decider.name,
      decisionNote: volunteerRoleAssignments.decisionNote,
      endedAt: volunteerRoleAssignments.endedAt,
      endedByName: ender.name,
      endReason: volunteerRoleAssignments.endReason,
      snapshot: volunteerRoleAssignments.expectedMinutes,
    })
    .from(volunteerRoleAssignments)
    .innerJoin(volunteerRoles, eq(volunteerRoles.id, volunteerRoleAssignments.roleId))
    .innerJoin(users, eq(users.id, volunteerRoleAssignments.userId))
    .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
    .leftJoin(seasons, eq(seasons.id, volunteerRoleAssignments.seasonId))
    .leftJoin(decider, eq(decider.id, volunteerRoleAssignments.decidedByUserId))
    .leftJoin(ender, eq(ender.id, volunteerRoleAssignments.endedByUserId))
    .where(and(...conds))
    .orderBy(
      sql`case ${volunteerRoleAssignments.status} when 'pending' then 0 when 'active' then 1 else 2 end`,
      desc(volunteerRoleAssignments.signedUpAt)
    )
    .limit(500);
  if (rows.length === 0) return [];

  const progress = await getAssignmentProgress(rows.map((r) => r.id));

  // Credential readiness: verified and unexpired.
  const allCredIds = [...new Set(rows.flatMap((r) => r.requiredCredentialIds))];
  const credNames = await credentialNameMap(allCredIds);
  const have = new Set<string>();
  if (allCredIds.length) {
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const held = await db
      .select({ userId: userCredentials.userId, definitionId: userCredentials.definitionId })
      .from(userCredentials)
      .where(
        and(
          inArray(userCredentials.userId, userIds),
          inArray(userCredentials.definitionId, allCredIds),
          eq(userCredentials.status, "verified"),
          or(isNull(userCredentials.expiresAt), sql`${userCredentials.expiresAt} > now()`)
        )
      );
    for (const h of held) have.add(`${h.userId}:${h.definitionId}`);
  }

  return rows.map((r) => {
    const canManage = canManageVolunteerRole(ctx, r.programId);
    const credentials = r.requiredCredentialIds.map((id) => ({
      id,
      name: credNames.get(id) ?? "Unknown credential",
      ok: have.has(`${r.userId}:${id}`),
    }));
    return {
      id: r.id,
      roleId: r.roleId,
      roleName: r.roleName,
      programId: r.programId,
      programName: r.programName,
      programSlug: r.programSlug,
      period: r.period,
      grantsProgramRole: r.grantsProgramRole,
      userId: r.userId,
      userName: r.userName,
      userEmail: canManage ? r.userEmail : null,
      termKey: r.termKey,
      termLabel: r.seasonName ?? String(r.year ?? ""),
      status: r.status,
      signupNote: r.signupNote,
      signedUpAt: r.signedUpAt,
      decidedAt: r.decidedAt,
      decidedByName: r.decidedByName,
      decisionNote: r.decisionNote,
      endedAt: r.endedAt,
      endedByName: r.endedByName,
      endReason: r.endReason,
      expectedMinutes: r.snapshot ?? r.roleExpectedMinutes,
      progress: progress.get(r.id) ?? { verifiedMinutes: 0, pendingMinutes: 0 },
      credentials,
      missingCredentialCount: credentials.filter((c) => !c.ok).length,
      canManage,
      isSelf: r.userId === ctx.userId,
      selfApprovalBlocked: isBlockedSelfGrant(ctx, r, r.userId),
    };
  });
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const SELF_GRANT_MESSAGE =
  "You can't approve or assign yourself to a role that grants permissions. Ask another manager to do it.";

/** Program admins may not hand themselves a permission-granting role; the board may (their grants are audited). */
function isBlockedSelfGrant(ctx: SessionContext, role: { grantsProgramRole: ProgramRole | null }, userId: string): boolean {
  return !!role.grantsProgramRole && userId === ctx.userId && !isBoard(ctx);
}

function isSelfApproved(ctx: SessionContext, role: { grantsProgramRole: ProgramRole | null }, userId: string): boolean {
  return !!role.grantsProgramRole && userId === ctx.userId && isBoard(ctx);
}

/** Credential types the volunteer is missing (verified + unexpired required). */
async function missingCredentialNames(userId: string, requiredIds: string[], tx: DbOrTx): Promise<string[]> {
  if (requiredIds.length === 0) return [];
  const held = await tx
    .select({ definitionId: userCredentials.definitionId })
    .from(userCredentials)
    .where(
      and(
        eq(userCredentials.userId, userId),
        inArray(userCredentials.definitionId, requiredIds),
        eq(userCredentials.status, "verified"),
        or(isNull(userCredentials.expiresAt), sql`${userCredentials.expiresAt} > now()`)
      )
    );
  const ok = new Set(held.map((h) => h.definitionId));
  const names = await credentialNameMap(requiredIds);
  return requiredIds.filter((id) => !ok.has(id)).map((id) => names.get(id) ?? "Unknown credential");
}

export async function approveAssignment(
  ctx: SessionContext,
  id: string,
  note?: string | null
): Promise<{ missingCredentials: string[]; grantedAccess: boolean }> {
  parseId(id, "Sign-up");
  const decisionNote = parseInput(noteSchema, note);

  return db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ roleId: volunteerRoleAssignments.roleId })
      .from(volunteerRoleAssignments)
      .where(eq(volunteerRoleAssignments.id, id))
      .limit(1);
    if (!peek) throw new DalError("NOT_FOUND", "Sign-up not found.");

    // Lock order: role, then assignment (same as sign-up) so concurrent approvals serialize.
    const [role] = await tx.select().from(volunteerRoles).where(eq(volunteerRoles.id, peek.roleId)).for("update").limit(1);
    if (!role) throw new DalError("NOT_FOUND", "Role not found.");
    if (!canManageVolunteerRole(ctx, role.programId)) throw forbidden();
    if (role.programId) await assertProgramReachable(ctx, role.programId, tx);

    const [a] = await tx
      .select()
      .from(volunteerRoleAssignments)
      .where(eq(volunteerRoleAssignments.id, id))
      .for("update")
      .limit(1);
    if (!a) throw new DalError("NOT_FOUND", "Sign-up not found.");
    if (a.status !== "pending") throw new DalError("INVALID", "This sign-up is no longer pending.");
    if (isBlockedSelfGrant(ctx, role, a.userId)) throw new DalError("FORBIDDEN", SELF_GRANT_MESSAGE);
    if (!role.isActive) throw new DalError("INVALID", "This role is archived. Restore it before approving sign-ups.");

    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, a.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw new DalError("INVALID", "This volunteer's account is no longer active.");

    if (role.slots !== null) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(volunteerRoleAssignments)
        .where(
          and(
            eq(volunteerRoleAssignments.roleId, role.id),
            eq(volunteerRoleAssignments.termKey, a.termKey),
            eq(volunteerRoleAssignments.status, "active")
          )
        );
      if (n >= role.slots) throw new DalError("INVALID", "All slots for this term are filled.");
    }

    const programRoleId = await grantLinkedProgramRole(tx, a, role);
    const now = new Date();
    await tx
      .update(volunteerRoleAssignments)
      .set({
        status: "active",
        expectedMinutes: role.expectedMinutes,
        decidedAt: now,
        decidedByUserId: ctx.userId,
        decisionNote,
        programRoleId,
      })
      .where(eq(volunteerRoleAssignments.id, id));

    const missing = await missingCredentialNames(a.userId, role.requiredCredentialIds, tx);
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "volunteer_role.approved",
        targetType: "volunteer_role_assignment",
        targetId: id,
        metadata: {
          roleId: role.id,
          roleName: role.name,
          programId: role.programId,
          userId: a.userId,
          termKey: a.termKey,
          expectedMinutes: role.expectedMinutes,
          grantsProgramRole: role.grantsProgramRole,
          programRoleId,
          missingCredentials: missing,
          ...(isSelfApproved(ctx, role, a.userId) ? { selfApproved: true } : {}),
        },
      },
      tx
    );
    return { missingCredentials: missing, grantedAccess: !!role.grantsProgramRole };
  });
}

export async function declineAssignment(ctx: SessionContext, id: string, reason: string): Promise<void> {
  parseId(id, "Sign-up");
  const why = parseInput(reasonSchema, reason);

  await db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ roleId: volunteerRoleAssignments.roleId })
      .from(volunteerRoleAssignments)
      .where(eq(volunteerRoleAssignments.id, id))
      .limit(1);
    if (!peek) throw new DalError("NOT_FOUND", "Sign-up not found.");
    const [role] = await tx.select().from(volunteerRoles).where(eq(volunteerRoles.id, peek.roleId)).for("update").limit(1);
    if (!role) throw new DalError("NOT_FOUND", "Role not found.");
    if (!canManageVolunteerRole(ctx, role.programId)) throw forbidden();
    if (role.programId) await assertProgramReachable(ctx, role.programId, tx);

    const [a] = await tx.select().from(volunteerRoleAssignments).where(eq(volunteerRoleAssignments.id, id)).for("update").limit(1);
    if (!a) throw new DalError("NOT_FOUND", "Sign-up not found.");
    if (a.status !== "pending") throw new DalError("INVALID", "This sign-up is no longer pending.");

    await tx
      .update(volunteerRoleAssignments)
      .set({ status: "declined", decidedAt: new Date(), decidedByUserId: ctx.userId, decisionNote: why })
      .where(eq(volunteerRoleAssignments.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "volunteer_role.declined",
        targetType: "volunteer_role_assignment",
        targetId: id,
        metadata: { roleId: role.id, roleName: role.name, programId: role.programId, userId: a.userId, termKey: a.termKey, reason: why },
      },
      tx
    );
  });
}

/** Ends an active assignment, revokes the permission it granted, and keeps all history and logged hours. */
export async function endAssignment(ctx: SessionContext, id: string, reason: string): Promise<{ revokedAccess: boolean }> {
  parseId(id, "Assignment");
  const why = parseInput(reasonSchema, reason);

  return db.transaction(async (tx) => {
    const [peek] = await tx
      .select({ roleId: volunteerRoleAssignments.roleId })
      .from(volunteerRoleAssignments)
      .where(eq(volunteerRoleAssignments.id, id))
      .limit(1);
    if (!peek) throw new DalError("NOT_FOUND", "Assignment not found.");
    const [role] = await tx.select().from(volunteerRoles).where(eq(volunteerRoles.id, peek.roleId)).for("update").limit(1);
    if (!role) throw new DalError("NOT_FOUND", "Role not found.");
    if (!canManageVolunteerRole(ctx, role.programId)) throw forbidden();
    if (role.programId) await assertProgramReachable(ctx, role.programId, tx);

    const [a] = await tx.select().from(volunteerRoleAssignments).where(eq(volunteerRoleAssignments.id, id)).for("update").limit(1);
    if (!a) throw new DalError("NOT_FOUND", "Assignment not found.");
    if (a.status !== "active") throw new DalError("INVALID", "Only active assignments can be ended.");

    await revokeLinkedProgramRole(tx, a);
    await tx
      .update(volunteerRoleAssignments)
      .set({ status: "ended", endedAt: new Date(), endedByUserId: ctx.userId, endReason: why })
      .where(eq(volunteerRoleAssignments.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "volunteer_role.ended",
        targetType: "volunteer_role_assignment",
        targetId: id,
        metadata: {
          roleId: role.id,
          roleName: role.name,
          programId: role.programId,
          userId: a.userId,
          termKey: a.termKey,
          reason: why,
          revokedProgramRoleId: a.programRoleId,
        },
      },
      tx
    );
    return { revokedAccess: !!a.programRoleId };
  });
}

/** A manager directly assigns an existing user: created active, snapshot taken, permission granted. */
export async function assignVolunteer(
  ctx: SessionContext,
  input: AssignInput
): Promise<{ id: string; missingCredentials: string[] }> {
  const data = parseInput(assignInputSchema, input);

  return db
    .transaction(async (tx) => {
      const [role] = await tx.select().from(volunteerRoles).where(eq(volunteerRoles.id, data.roleId)).for("update").limit(1);
      if (!role) throw new DalError("NOT_FOUND", "Role not found.");
      if (!canManageVolunteerRole(ctx, role.programId)) throw forbidden();
      if (role.programId) await assertProgramReachable(ctx, role.programId, tx);
      if (!role.isActive) throw new DalError("INVALID", "This role is archived. Restore it before assigning volunteers.");
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${data.email}`, isNull(users.deletedAt)))
        .limit(1);
      if (!user) throw new DalError("INVALID", "Ask them to sign in once first.");
      if (isBlockedSelfGrant(ctx, role, user.id)) throw new DalError("FORBIDDEN", SELF_GRANT_MESSAGE);

      // Term must fit the role's period.
      let seasonId: string | null = null;
      let year: number | null = null;
      let termKey: string;
      if (role.period === "per_season") {
        if (!data.seasonId || data.year) throw new DalError("INVALID", "Choose a season for this per-season role.");
        const [s] = await tx
          .select({ id: seasons.id, programId: seasons.programId, isActive: seasons.isActive, endsOn: seasons.endsOn })
          .from(seasons)
          .where(eq(seasons.id, data.seasonId))
          .limit(1);
        if (!s || s.programId !== role.programId) throw new DalError("INVALID", "That season doesn't belong to this role's program.");
        if (!s.isActive || (s.endsOn !== null && s.endsOn < laToday())) {
          throw new DalError("INVALID", "That season is inactive or has already ended.");
        }
        seasonId = s.id;
        termKey = termKeyForSeason(s.id);
      } else {
        const cy = laYearOf(new Date());
        if (!data.year || data.seasonId) throw new DalError("INVALID", "Choose a year for this per-year role.");
        if (data.year < cy || data.year > cy + 1) throw new DalError("INVALID", `Choose ${cy} or ${cy + 1}.`);
        year = data.year;
        termKey = termKeyForYear(year);
      }

      const [{ live, dup }] = await tx
        .select({
          live: sql<number>`count(*)`.mapWith(Number),
          dup: sql<number>`count(*) filter (where ${volunteerRoleAssignments.userId} = ${user.id})`.mapWith(Number),
        })
        .from(volunteerRoleAssignments)
        .where(
          and(
            eq(volunteerRoleAssignments.roleId, role.id),
            eq(volunteerRoleAssignments.termKey, termKey),
            inArray(volunteerRoleAssignments.status, ["pending", "active"])
          )
        );
      if (dup > 0) throw new DalError("INVALID", "That volunteer already has a pending or active sign-up for this term.");
      if (role.slots !== null && live >= role.slots) {
        throw new DalError("INVALID", "All slots for this term are filled (pending sign-ups count). Decline or end one first.");
      }

      const now = new Date();
      const [row] = await tx
        .insert(volunteerRoleAssignments)
        .values({
          roleId: role.id,
          userId: user.id,
          seasonId,
          year,
          termKey,
          status: "active",
          expectedMinutes: role.expectedMinutes,
          signupNote: data.note,
          decidedAt: now,
          decidedByUserId: ctx.userId,
          decisionNote: "Assigned directly by a manager",
        })
        .returning();
      const programRoleId = await grantLinkedProgramRole(tx, row, role);
      if (programRoleId) {
        await tx.update(volunteerRoleAssignments).set({ programRoleId }).where(eq(volunteerRoleAssignments.id, row.id));
      }
      const missing = await missingCredentialNames(user.id, role.requiredCredentialIds, tx);
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "volunteer_role.approved",
          targetType: "volunteer_role_assignment",
          targetId: row.id,
          metadata: {
            direct: true,
            roleId: role.id,
            roleName: role.name,
            programId: role.programId,
            userId: user.id,
            termKey,
            expectedMinutes: role.expectedMinutes,
            grantsProgramRole: role.grantsProgramRole,
            programRoleId,
            missingCredentials: missing,
            ...(isSelfApproved(ctx, role, user.id) ? { selfApproved: true } : {}),
          },
        },
        tx
      );
      return { id: row.id, missingCredentials: missing };
    })
    .catch((err) => {
      if (isUniqueViolation(err)) throw new DalError("INVALID", "That volunteer already has a pending or active sign-up for this term.");
      throw err;
    });
}
