import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
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
import { formatExpectation, type AssignmentStatus, type VolunteerRolePeriod } from "@/lib/volunteer-roles";
import type { VolunteerCategory } from "@/lib/volunteer-categories";
import { assignmentIdSchema, signUpSchema, type SignUpInput } from "@/lib/validation/volunteer-role-signups";
import { DalError, isBoard, type SessionContext } from "./context";
import {
  getAssignmentProgress,
  getTermBounds,
  revokeLinkedProgramRole,
  termKeyForSeason,
  termKeyForYear,
} from "./volunteer-role-shared";

/*
 * Volunteer-facing side of volunteer roles: find roles, sign up, withdraw, my roles.
 * Approval, catalog and manager actions live in volunteer-roles.ts (WR1).
 */

export interface OfferedTerm {
  /** "season:<uuid>" | "year:<yyyy>" (also the <select> value). */
  termKey: string;
  seasonId: string | null;
  year: number | null;
  label: string;
  /** Live (pending + active) assignments still allowed; null = unlimited. */
  slotsLeft: number | null;
  myStatus: "pending" | "active" | null;
  myAssignmentId: string | null;
}

export interface RoleCredentialStatus {
  id: string;
  name: string;
  /** I hold a verified, unexpired credential of this type. */
  ready: boolean;
}

export interface OpenRoleRow {
  id: string;
  name: string;
  description: string | null;
  programId: string | null;
  programName: string | null;
  period: VolunteerRolePeriod;
  expectedMinutes: number;
  expectationText: string;
  requiresApproval: boolean;
  /** Approval gives roster / emergency-sheet access. */
  grantsAccess: boolean;
  slots: number | null;
  credentials: RoleCredentialStatus[];
  terms: OfferedTerm[];
}

export interface MyAssignmentRow {
  id: string;
  roleId: string;
  roleName: string;
  programId: string | null;
  programName: string | null;
  period: VolunteerRolePeriod;
  termLabel: string;
  status: AssignmentStatus;
  /** Snapshot once active; the role's current value while pending. */
  expectedMinutes: number;
  isSnapshot: boolean;
  verifiedMinutes: number;
  pendingMinutes: number;
  grantsAccess: boolean;
  signedUpAt: Date;
  signupNote: string | null;
  decisionNote: string | null;
  endReason: string | null;
  isLive: boolean;
}

export interface AssignmentChoice {
  id: string;
  roleName: string;
  termLabel: string;
  programId: string | null;
  programName: string | null;
  category: VolunteerCategory;
  /** Term bounds as LA dates (YYYY-MM-DD, inclusive); null when unknown. */
  termMin: string | null;
  termMax: string | null;
  /** Only set for the board's on-behalf picker. */
  volunteerName?: string;
  volunteerEmail?: string;
}

type DbLike = DbOrTx;

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/** Years offered for per_year roles: this LA year, plus next year from October 1. */
export function offeredYears(now: Date): number[] {
  const today = utcToLaDateInput(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month >= 10 ? [year, year + 1] : [year];
}

interface TermDef {
  termKey: string;
  seasonId: string | null;
  year: number | null;
  label: string;
}

async function loadOfferedSeasons(tx: DbLike, programIds: string[], now: Date) {
  if (programIds.length === 0) return [];
  const today = utcToLaDateInput(now);
  return tx
    .select({
      id: seasons.id,
      programId: seasons.programId,
      name: seasons.name,
    })
    .from(seasons)
    .where(
      and(
        inArray(seasons.programId, programIds),
        eq(seasons.isActive, true),
        or(isNull(seasons.endsOn), gte(seasons.endsOn, today))
      )
    )
    .orderBy(sql`${seasons.startsOn} asc nulls last`, asc(seasons.createdAt));
}

function termsForRole(
  role: { period: VolunteerRolePeriod; programId: string | null },
  seasonRows: { id: string; programId: string; name: string }[],
  now: Date
): TermDef[] {
  if (role.period === "per_season") {
    return seasonRows
      .filter((s) => s.programId === role.programId)
      .map((s) => ({ termKey: termKeyForSeason(s.id), seasonId: s.id, year: null, label: s.name }));
  }
  return offeredYears(now).map((y) => ({ termKey: termKeyForYear(y), seasonId: null, year: y, label: String(y) }));
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e === "object" && (e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Find a role
// ---------------------------------------------------------------------------

export async function listOpenRoles(
  ctx: SessionContext,
  opts: { programId?: string | null } = {},
  now: Date = new Date()
): Promise<OpenRoleRow[]> {
  const programFilter = opts.programId
    ? eq(volunteerRoles.programId, opts.programId)
    : undefined;
  const roles = await db
    .select({
      id: volunteerRoles.id,
      name: volunteerRoles.name,
      description: volunteerRoles.description,
      programId: volunteerRoles.programId,
      programName: programs.name,
      period: volunteerRoles.period,
      expectedMinutes: volunteerRoles.expectedMinutes,
      requiresApproval: volunteerRoles.requiresApproval,
      grantsProgramRole: volunteerRoles.grantsProgramRole,
      slots: volunteerRoles.slots,
      requiredCredentialIds: volunteerRoles.requiredCredentialIds,
    })
    .from(volunteerRoles)
    .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
    .where(
      and(
        eq(volunteerRoles.isActive, true),
        or(isNull(volunteerRoles.programId), and(eq(programs.isActive, true), isNull(programs.deletedAt))),
        programFilter
      )
    )
    .orderBy(asc(programs.name), asc(volunteerRoles.name));
  if (roles.length === 0) return [];

  const roleIds = roles.map((r) => r.id);
  const programIds = [...new Set(roles.map((r) => r.programId).filter((p): p is string => !!p))];
  const credIds = [...new Set(roles.flatMap((r) => r.requiredCredentialIds))];

  const [seasonRows, liveCounts, mine, defs, myCreds] = await Promise.all([
    loadOfferedSeasons(db, programIds, now),
    db
      .select({
        roleId: volunteerRoleAssignments.roleId,
        termKey: volunteerRoleAssignments.termKey,
        n: sql<number>`count(*)::int`,
      })
      .from(volunteerRoleAssignments)
      .where(
        and(
          inArray(volunteerRoleAssignments.roleId, roleIds),
          inArray(volunteerRoleAssignments.status, ["pending", "active"])
        )
      )
      .groupBy(volunteerRoleAssignments.roleId, volunteerRoleAssignments.termKey),
    db
      .select({
        id: volunteerRoleAssignments.id,
        roleId: volunteerRoleAssignments.roleId,
        termKey: volunteerRoleAssignments.termKey,
        status: volunteerRoleAssignments.status,
      })
      .from(volunteerRoleAssignments)
      .where(
        and(
          eq(volunteerRoleAssignments.userId, ctx.userId),
          inArray(volunteerRoleAssignments.roleId, roleIds),
          inArray(volunteerRoleAssignments.status, ["pending", "active"])
        )
      ),
    credIds.length
      ? db
          .select({ id: credentialDefinitions.id, name: credentialDefinitions.name })
          .from(credentialDefinitions)
          .where(inArray(credentialDefinitions.id, credIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    credIds.length
      ? db
          .select({ definitionId: userCredentials.definitionId })
          .from(userCredentials)
          .where(
            and(
              eq(userCredentials.userId, ctx.userId),
              inArray(userCredentials.definitionId, credIds),
              eq(userCredentials.status, "verified"),
              or(isNull(userCredentials.expiresAt), sql`${userCredentials.expiresAt} > ${now.toISOString()}`)
            )
          )
      : Promise.resolve([] as { definitionId: string }[]),
  ]);

  const countMap = new Map(liveCounts.map((c) => [`${c.roleId}|${c.termKey}`, c.n]));
  const mineMap = new Map(mine.map((m) => [`${m.roleId}|${m.termKey}`, m]));
  const defName = new Map(defs.map((d) => [d.id, d.name]));
  const ready = new Set(myCreds.map((c) => c.definitionId));

  return roles.map((r) => {
    const terms: OfferedTerm[] = termsForRole(r, seasonRows, now).map((t) => {
      const live = countMap.get(`${r.id}|${t.termKey}`) ?? 0;
      const my = mineMap.get(`${r.id}|${t.termKey}`);
      return {
        ...t,
        slotsLeft: r.slots === null ? null : Math.max(0, r.slots - live),
        myStatus: my ? (my.status as "pending" | "active") : null,
        myAssignmentId: my?.id ?? null,
      };
    });
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      programId: r.programId,
      programName: r.programName,
      period: r.period,
      expectedMinutes: r.expectedMinutes,
      expectationText: formatExpectation(r.expectedMinutes, r.period),
      requiresApproval: r.requiresApproval,
      grantsAccess: r.grantsProgramRole !== null,
      slots: r.slots,
      credentials: r.requiredCredentialIds
        .filter((id) => defName.has(id))
        .map((id) => ({ id, name: defName.get(id) as string, ready: ready.has(id) })),
      terms,
    };
  });
}

// ---------------------------------------------------------------------------
// Sign up / withdraw
// ---------------------------------------------------------------------------

export async function signUpForRole(
  ctx: SessionContext,
  input: SignUpInput,
  now: Date = new Date()
): Promise<{ id: string; status: "pending" | "active" }> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) throw new DalError("INVALID", parsed.error.issues[0]?.message ?? "Invalid input.");
  const data = parsed.data;

  try {
    return await db.transaction(async (tx) => {
      // Serialize sign-ups per role so the slot count below cannot be raced.
      const [role] = await tx
        .select()
        .from(volunteerRoles)
        .where(eq(volunteerRoles.id, data.roleId))
        .for("update")
        .limit(1);
      if (!role || !role.isActive) throw new DalError("INVALID", "This role is not open for sign-ups.");
      if (role.programId) {
        const [p] = await tx
          .select({ id: programs.id })
          .from(programs)
          .where(and(eq(programs.id, role.programId), eq(programs.isActive, true), isNull(programs.deletedAt)))
          .limit(1);
        if (!p) throw new DalError("INVALID", "This role is not open for sign-ups.");
      }

      // Only offered terms are accepted (server-side, regardless of what the UI showed).
      const termKey = data.seasonId ? termKeyForSeason(data.seasonId) : termKeyForYear(data.year as number);
      const seasonRows = role.programId ? await loadOfferedSeasons(tx, [role.programId], now) : [];
      const term = termsForRole(role, seasonRows, now).find((t) => t.termKey === termKey);
      if (!term) throw new DalError("INVALID", "That term is not open for sign-ups for this role.");

      const live = await tx
        .select({ id: volunteerRoleAssignments.id, userId: volunteerRoleAssignments.userId })
        .from(volunteerRoleAssignments)
        .where(
          and(
            eq(volunteerRoleAssignments.roleId, role.id),
            eq(volunteerRoleAssignments.termKey, termKey),
            inArray(volunteerRoleAssignments.status, ["pending", "active"])
          )
        );
      if (live.some((a) => a.userId === ctx.userId)) {
        throw new DalError("INVALID", "You are already signed up for this role for that term.");
      }
      if (role.slots !== null && live.length >= role.slots) {
        throw new DalError("INVALID", "Sorry, all spots for that term have just been taken.");
      }

      const status = role.requiresApproval ? "pending" : "active";
      const [row] = await tx
        .insert(volunteerRoleAssignments)
        .values({
          roleId: role.id,
          userId: ctx.userId,
          seasonId: term.seasonId,
          year: term.year,
          termKey,
          status,
          expectedMinutes: status === "active" ? role.expectedMinutes : null,
          signupNote: data.note,
        })
        .returning({ id: volunteerRoleAssignments.id });

      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "volunteer_role.signed_up",
          targetType: "volunteer_role_assignment",
          targetId: row.id,
          metadata: { roleId: role.id, programId: role.programId, termKey, status },
        },
        tx
      );
      return { id: row.id, status };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DalError("INVALID", "You are already signed up for this role for that term.");
    }
    throw err;
  }
}

/** Withdraw my own pending or active sign-up; revokes any permission it granted. */
export async function withdrawMyAssignment(ctx: SessionContext, assignmentId: string): Promise<void> {
  const idr = assignmentIdSchema.safeParse(assignmentId);
  if (!idr.success) throw new DalError("NOT_FOUND", "Role sign-up not found.");
  const id = idr.data;
  await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(volunteerRoleAssignments)
      .where(eq(volunteerRoleAssignments.id, id))
      .for("update")
      .limit(1);
    // Other people's rows are hidden behind NOT_FOUND.
    if (!a || a.userId !== ctx.userId) throw new DalError("NOT_FOUND", "Role sign-up not found.");
    if (a.status !== "pending" && a.status !== "active") {
      throw new DalError("INVALID", "This sign-up is already closed.");
    }
    const now = new Date();
    await tx
      .update(volunteerRoleAssignments)
      .set({ status: "withdrawn", endedAt: now, endedByUserId: ctx.userId, endReason: "Withdrawn by volunteer" })
      .where(eq(volunteerRoleAssignments.id, id));
    await revokeLinkedProgramRole(tx, a);
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "volunteer_role.withdrawn",
        targetType: "volunteer_role_assignment",
        targetId: id,
        metadata: { roleId: a.roleId, termKey: a.termKey, previousStatus: a.status, revokedAccess: !!a.programRoleId },
      },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// My roles
// ---------------------------------------------------------------------------

export async function listMyAssignments(ctx: SessionContext): Promise<MyAssignmentRow[]> {
  const rows = await db
    .select({
      id: volunteerRoleAssignments.id,
      roleId: volunteerRoleAssignments.roleId,
      roleName: volunteerRoles.name,
      programId: volunteerRoles.programId,
      programName: programs.name,
      period: volunteerRoles.period,
      roleExpected: volunteerRoles.expectedMinutes,
      grantsProgramRole: volunteerRoles.grantsProgramRole,
      seasonName: seasons.name,
      year: volunteerRoleAssignments.year,
      status: volunteerRoleAssignments.status,
      snapshot: volunteerRoleAssignments.expectedMinutes,
      signedUpAt: volunteerRoleAssignments.signedUpAt,
      signupNote: volunteerRoleAssignments.signupNote,
      decisionNote: volunteerRoleAssignments.decisionNote,
      endReason: volunteerRoleAssignments.endReason,
    })
    .from(volunteerRoleAssignments)
    .innerJoin(volunteerRoles, eq(volunteerRoles.id, volunteerRoleAssignments.roleId))
    .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
    .leftJoin(seasons, eq(seasons.id, volunteerRoleAssignments.seasonId))
    .where(eq(volunteerRoleAssignments.userId, ctx.userId))
    .orderBy(desc(volunteerRoleAssignments.signedUpAt));

  const progress = await getAssignmentProgress(rows.map((r) => r.id));
  const out: MyAssignmentRow[] = rows.map((r) => {
    const p = progress.get(r.id) ?? { verifiedMinutes: 0, pendingMinutes: 0 };
    const isLive = r.status === "pending" || r.status === "active";
    return {
      id: r.id,
      roleId: r.roleId,
      roleName: r.roleName,
      programId: r.programId,
      programName: r.programName,
      period: r.period,
      termLabel: r.seasonName ?? String(r.year),
      status: r.status,
      expectedMinutes: r.snapshot ?? r.roleExpected,
      isSnapshot: r.snapshot !== null,
      verifiedMinutes: p.verifiedMinutes,
      pendingMinutes: p.pendingMinutes,
      grantsAccess: r.grantsProgramRole !== null,
      signedUpAt: r.signedUpAt,
      signupNote: r.signupNote,
      decisionNote: r.decisionNote,
      endReason: r.endReason,
      isLive,
    };
  });
  const rank = (a: MyAssignmentRow) => (a.status === "active" ? 0 : a.status === "pending" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b)); // stable: newest first within a group
}

// ---------------------------------------------------------------------------
// Hours form helpers
// ---------------------------------------------------------------------------

async function choicesFor(
  rows: {
    id: string;
    roleName: string;
    programId: string | null;
    programName: string | null;
    category: VolunteerCategory;
    seasonId: string | null;
    year: number | null;
    volunteerName?: string;
    volunteerEmail?: string;
  }[]
): Promise<AssignmentChoice[]> {
  const out: AssignmentChoice[] = [];
  const cache = new Map<string, Awaited<ReturnType<typeof getTermBounds>>>();
  for (const r of rows) {
    const key = r.seasonId ?? `y${r.year}`;
    let b = cache.get(key);
    if (!b) {
      b = await getTermBounds({ seasonId: r.seasonId, year: r.year });
      cache.set(key, b);
    }
    out.push({
      id: r.id,
      roleName: r.roleName,
      termLabel: b.label,
      programId: r.programId,
      programName: r.programName,
      category: r.category,
      termMin: b.start ? utcToLaDateInput(b.start) : null,
      termMax: b.end ? utcToLaDateInput(new Date(b.end.getTime() - 1)) : null,
      volunteerName: r.volunteerName,
      volunteerEmail: r.volunteerEmail,
    });
  }
  return out;
}

/** My active assignments, for the "Volunteer role (optional)" select on the hours form. */
export async function listMyActiveAssignmentChoices(ctx: SessionContext): Promise<AssignmentChoice[]> {
  const rows = await db
    .select({
      id: volunteerRoleAssignments.id,
      roleName: volunteerRoles.name,
      programId: volunteerRoles.programId,
      programName: programs.name,
      category: volunteerRoles.category,
      seasonId: volunteerRoleAssignments.seasonId,
      year: volunteerRoleAssignments.year,
    })
    .from(volunteerRoleAssignments)
    .innerJoin(volunteerRoles, eq(volunteerRoles.id, volunteerRoleAssignments.roleId))
    .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
    .where(and(eq(volunteerRoleAssignments.userId, ctx.userId), eq(volunteerRoleAssignments.status, "active")))
    .orderBy(asc(volunteerRoles.name), desc(volunteerRoleAssignments.signedUpAt));
  return choicesFor(rows);
}

const BOARD_PICKER_LIMIT = 300;

/** Board only: every active assignment, for the "log hours for a volunteer" picker. */
export async function listActiveAssignmentChoicesForBoard(ctx: SessionContext): Promise<AssignmentChoice[]> {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
  const rows = await db
    .select({
      id: volunteerRoleAssignments.id,
      roleName: volunteerRoles.name,
      programId: volunteerRoles.programId,
      programName: programs.name,
      category: volunteerRoles.category,
      seasonId: volunteerRoleAssignments.seasonId,
      year: volunteerRoleAssignments.year,
      volunteerName: users.name,
      volunteerEmail: users.email,
    })
    .from(volunteerRoleAssignments)
    .innerJoin(volunteerRoles, eq(volunteerRoles.id, volunteerRoleAssignments.roleId))
    .innerJoin(users, eq(users.id, volunteerRoleAssignments.userId))
    .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
    .where(and(eq(volunteerRoleAssignments.status, "active"), isNull(users.deletedAt)))
    .orderBy(asc(users.name), asc(volunteerRoles.name))
    .limit(BOARD_PICKER_LIMIT);
  return choicesFor(rows);
}

/** My summary for the dashboard: active roles + verified vs expected minutes. */
export async function getMyRolesSummary(ctx: SessionContext) {
  const rows = (await listMyAssignments(ctx)).filter((a) => a.status === "active");
  return {
    activeCount: rows.length,
    pendingCount: (await countMyPending(ctx.userId)) ?? 0,
    expectedMinutes: rows.reduce((s, r) => s + r.expectedMinutes, 0),
    verifiedMinutes: rows.reduce((s, r) => s + r.verifiedMinutes, 0),
    pendingMinutes: rows.reduce((s, r) => s + r.pendingMinutes, 0),
    roles: rows.slice(0, 3).map((r) => ({ id: r.id, name: r.roleName, term: r.termLabel })),
  };
}

async function countMyPending(userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(volunteerRoleAssignments)
    .where(and(eq(volunteerRoleAssignments.userId, userId), eq(volunteerRoleAssignments.status, "pending")));
  return r?.n ?? 0;
}
