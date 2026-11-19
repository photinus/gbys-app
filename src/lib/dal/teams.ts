import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { ZodType } from "zod";
import { db, type DbOrTx, type DbTx } from "@/db";
import {
  athletes,
  credentialDefinitions,
  householdGuardians,
  programRoles,
  programs,
  registrations,
  seasons,
  teamEvents,
  teamPlayers,
  teamStaff,
  teams,
  userCredentials,
  users,
  volunteerRoleAssignments,
  volunteerRoles,
} from "@/db/schema";
import { ageFromDob } from "@/components/household/age";
import { writeAudit } from "@/lib/audit";
import {
  jerseySchema,
  registrationIdsSchema,
  teamInputSchema,
  teamStaffInputSchema,
  updateTeamSchema,
  type TeamInput,
  type TeamStaffInput,
  type TeamStaffRoleValue,
  type UpdateTeamInput,
} from "@/lib/validation/teams";
import { DalError, isBoard, type SessionContext } from "./context";
import { assertProgramReachable, canManageProgram, canViewTeam } from "./permissions";
import { athletePhotoUrl } from "./photos";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseId(id: string, what: string): string {
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", `${what} not found.`);
  return id;
}

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DalError("INVALID", r.error.issues[0]?.message ?? "Invalid input.");
  return r.data;
}

/** Postgres error code + constraint, whether or not drizzle wrapped the driver error. */
function pgViolation(e: unknown): { code?: string; constraint?: string } {
  let cur = e as { code?: unknown; constraint?: unknown; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && cur; i++) {
    if (typeof cur.code === "string" && cur.code.length === 5) {
      return { code: cur.code, constraint: typeof cur.constraint === "string" ? cur.constraint : undefined };
    }
    cur = cur.cause as typeof cur;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SeasonTeamHeader {
  seasonId: string;
  seasonName: string;
  programId: string;
  programName: string;
  programSlug: string;
  programActive: boolean;
}

export interface TeamSummary {
  id: string;
  name: string;
  division: string | null;
  color: string | null;
  isActive: boolean;
  playerCount: number;
  staffCount: number;
}

export type CredentialState = "ok" | "expired" | "pending" | "rejected" | "missing";

export interface CredentialReadinessItem {
  definitionId: string;
  name: string;
  state: CredentialState;
  expiresAt: Date | null;
}

export interface StaffReadiness {
  /** True when every credential the program requires is verified and unexpired. */
  ready: boolean;
  items: CredentialReadinessItem[];
}

export interface TeamStaffRow {
  teamStaffId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  role: TeamStaffRoleValue;
  /** Null unless the viewer can manage the program. */
  readiness: StaffReadiness | null;
}

export interface BuilderPlayer {
  teamPlayerId: string;
  registrationId: string;
  athleteName: string;
  age: number | null;
  jerseyNumber: string | null;
}

export interface BuilderTeam extends TeamSummary {
  players: BuilderPlayer[];
  staff: TeamStaffRow[];
}

/** Unassigned live registration. Deliberately has NO medical data. */
export interface UnassignedRegistration {
  registrationId: string;
  athleteName: string;
  age: number | null;
  answers: { key: string; label: string; value: string }[];
}

export interface TeamBuilderData {
  header: SeasonTeamHeader;
  teams: BuilderTeam[];
  unassigned: UnassignedRegistration[];
  requiredCredentialCount: number;
}

export interface StaffSuggestion {
  userId: string;
  name: string;
  email: string;
  suggestedRole: TeamStaffRoleValue;
  source: string;
}

export interface AssignResult {
  added: number;
  moved: number;
  unchanged: number;
}

export interface AddStaffResult {
  teamStaffId: string;
  name: string;
  readiness: StaffReadiness;
}

export interface OverviewPlayer {
  teamPlayerId: string;
  registrationId: string;
  athleteName: string;
  age: number | null;
  jerseyNumber: string | null;
  photoUrl: string | null;
  guardians: { name: string; phone: string | null }[];
}

export interface TeamOverview {
  team: { id: string; name: string; division: string | null; color: string | null; isActive: boolean };
  header: SeasonTeamHeader;
  canManage: boolean;
  isBoard: boolean;
  staff: TeamStaffRow[];
  roster: OverviewPlayer[];
  links: { overview: string; schedule: string; emergency: string; builder: string | null };
}

export interface MyTeamRow {
  id: string;
  name: string;
  division: string | null;
  color: string | null;
  programName: string;
  programSlug: string;
  seasonName: string;
  playerCount: number;
  /** Viewer's staff roles on this team (empty when they see it as an admin / board). */
  myRoles: TeamStaffRoleValue[];
  nextEvent: { id: string; kind: "practice" | "game" | "event"; title: string | null; opponent: string | null; startsAt: Date; endsAt: Date } | null;
}

// ---------------------------------------------------------------------------
// Internal loaders / guards
// ---------------------------------------------------------------------------
interface TeamCtx {
  id: string;
  seasonId: string;
  seasonName: string;
  programId: string;
  programName: string;
  programSlug: string;
  programActive: boolean;
  requiredCredentialIds: string[];
  name: string;
  division: string | null;
  color: string | null;
  isActive: boolean;
}

async function loadTeam(tx: DbOrTx, teamId: string): Promise<TeamCtx | null> {
  if (!UUID_RE.test(teamId)) return null;
  const [t] = await tx
    .select({
      id: teams.id,
      seasonId: teams.seasonId,
      seasonName: seasons.name,
      programId: programs.id,
      programName: programs.name,
      programSlug: programs.slug,
      programActive: programs.isActive,
      requiredCredentialIds: programs.requiredCredentialIds,
      name: teams.name,
      division: teams.division,
      color: teams.color,
      isActive: teams.isActive,
    })
    .from(teams)
    .innerJoin(seasons, eq(seasons.id, teams.seasonId))
    .innerJoin(programs, eq(programs.id, teams.programId))
    .where(and(eq(teams.id, teamId), isNull(programs.deletedAt)))
    .limit(1);
  return t ?? null;
}

/** Load a team the caller may MANAGE (program admin / board). Others get NOT_FOUND (cannot see it) or FORBIDDEN (can see it). */
async function loadManageableTeam(ctx: SessionContext, tx: DbOrTx, teamId: string): Promise<TeamCtx> {
  const t = await loadTeam(tx, teamId);
  if (!t) throw new DalError("NOT_FOUND", "Team not found.");
  if (!canManageProgram(ctx, t.programId)) {
    if (canViewTeam(ctx, t)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
    throw new DalError("NOT_FOUND", "Team not found.");
  }
  await assertProgramReachable(ctx, t.programId, tx);
  return t;
}

async function loadManageableSeason(ctx: SessionContext, tx: DbOrTx, seasonId: string): Promise<SeasonTeamHeader & { requiredCredentialIds: string[] }> {
  const id = parseId(seasonId, "Season");
  const [s] = await tx
    .select({
      seasonId: seasons.id,
      seasonName: seasons.name,
      programId: programs.id,
      programName: programs.name,
      programSlug: programs.slug,
      programActive: programs.isActive,
      requiredCredentialIds: programs.requiredCredentialIds,
    })
    .from(seasons)
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .where(and(eq(seasons.id, id), isNull(programs.deletedAt)))
    .limit(1);
  if (!s || !canManageProgram(ctx, s.programId)) throw new DalError("NOT_FOUND", "Season not found.");
  await assertProgramReachable(ctx, s.programId, tx);
  return s;
}

function renderAnswer(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v === null || v === undefined || v === "") return "";
  return String(v);
}

// ---------------------------------------------------------------------------
// Credential readiness
// ---------------------------------------------------------------------------
async function readinessFor(
  tx: DbOrTx,
  userIds: string[],
  requiredIds: string[]
): Promise<Map<string, StaffReadiness>> {
  const out = new Map<string, StaffReadiness>();
  if (userIds.length === 0) return out;
  if (requiredIds.length === 0) {
    for (const u of userIds) out.set(u, { ready: true, items: [] });
    return out;
  }
  const defs = await tx
    .select({ id: credentialDefinitions.id, name: credentialDefinitions.name })
    .from(credentialDefinitions)
    .where(inArray(credentialDefinitions.id, requiredIds));
  const creds = await tx
    .select({
      userId: userCredentials.userId,
      definitionId: userCredentials.definitionId,
      status: userCredentials.status,
      expiresAt: userCredentials.expiresAt,
    })
    .from(userCredentials)
    .where(and(inArray(userCredentials.userId, userIds), inArray(userCredentials.definitionId, requiredIds)));
  const now = Date.now();
  const rank: Record<CredentialState, number> = { ok: 5, pending: 4, expired: 3, rejected: 2, missing: 1 };
  for (const userId of userIds) {
    const items: CredentialReadinessItem[] = defs.map((d) => {
      let best: { state: CredentialState; expiresAt: Date | null } = { state: "missing", expiresAt: null };
      for (const c of creds) {
        if (c.userId !== userId || c.definitionId !== d.id) continue;
        let state: CredentialState;
        if (c.status === "verified") state = !c.expiresAt || c.expiresAt.getTime() > now ? "ok" : "expired";
        else if (c.status === "pending_review") state = "pending";
        else if (c.status === "expired") state = "expired";
        else state = "rejected";
        if (rank[state] > rank[best.state]) best = { state, expiresAt: c.expiresAt };
      }
      return { definitionId: d.id, name: d.name, state: best.state, expiresAt: best.expiresAt };
    });
    items.sort((a, b) => a.name.localeCompare(b.name));
    out.set(userId, { ready: items.every((i) => i.state === "ok"), items });
  }
  return out;
}

async function loadStaff(tx: DbOrTx, teamIds: string[], requiredIds: Map<string, string[]> | null): Promise<Map<string, TeamStaffRow[]>> {
  const out = new Map<string, TeamStaffRow[]>();
  if (teamIds.length === 0) return out;
  const rows = await tx
    .select({
      teamStaffId: teamStaff.id,
      teamId: teamStaff.teamId,
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: teamStaff.role,
    })
    .from(teamStaff)
    .innerJoin(users, eq(users.id, teamStaff.userId))
    .where(and(inArray(teamStaff.teamId, teamIds), isNull(teamStaff.removedAt)))
    .orderBy(asc(teamStaff.role), asc(users.name));
  // readiness per (team's program required list)
  const byReq = new Map<string, Set<string>>(); // key = required ids signature
  if (requiredIds) {
    for (const r of rows) {
      const req = requiredIds.get(r.teamId) ?? [];
      const key = [...req].sort().join(",");
      if (!byReq.has(key)) byReq.set(key, new Set());
      byReq.get(key)!.add(r.userId);
    }
  }
  const readinessByKey = new Map<string, Map<string, StaffReadiness>>();
  for (const [key, set] of byReq) {
    readinessByKey.set(key, await readinessFor(tx, [...set], key ? key.split(",") : []));
  }
  for (const r of rows) {
    const key = requiredIds ? [...(requiredIds.get(r.teamId) ?? [])].sort().join(",") : "";
    const list = out.get(r.teamId) ?? [];
    list.push({
      teamStaffId: r.teamStaffId,
      userId: r.userId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      role: r.role,
      readiness: requiredIds ? (readinessByKey.get(key)?.get(r.userId) ?? null) : null,
    });
    out.set(r.teamId, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
export async function listSeasonTeams(
  ctx: SessionContext,
  seasonId: string
): Promise<{ header: SeasonTeamHeader; teams: TeamSummary[] }> {
  const { requiredCredentialIds: _r, ...header } = await loadManageableSeason(ctx, db, seasonId);
  void _r;
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      division: teams.division,
      color: teams.color,
      isActive: teams.isActive,
      playerCount: sql<number>`(select count(*)::int from ${teamPlayers} tp inner join ${registrations} r on r.id = tp.registration_id where tp.team_id = teams.id and tp.removed_at is null and r.deleted_at is null)`,
      staffCount: sql<number>`(select count(*)::int from ${teamStaff} ts where ts.team_id = teams.id and ts.removed_at is null)`,
    })
    .from(teams)
    .where(eq(teams.seasonId, header.seasonId))
    .orderBy(asc(sql`lower(${teams.name})`));
  return { header, teams: rows };
}

export async function createTeam(ctx: SessionContext, seasonId: string, input: TeamInput): Promise<{ id: string }> {
  const data = parseInput(teamInputSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const season = await loadManageableSeason(ctx, tx, seasonId);
      const calendarToken = randomBytes(32).toString("base64url");
      const [row] = await tx
        .insert(teams)
        .values({
          seasonId: season.seasonId,
          programId: season.programId,
          name: data.name,
          division: data.division,
          color: data.color,
          calendarToken,
          createdByUserId: ctx.userId,
        })
        .returning({ id: teams.id });
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "team.created",
          targetType: "team",
          targetId: row.id,
          metadata: { seasonId: season.seasonId, programId: season.programId, name: data.name },
        },
        tx
      );
      return row;
    });
  } catch (e) {
    if (pgViolation(e).code === "23505") throw new DalError("INVALID", `A team named "${data.name}" already exists in this season.`);
    throw e;
  }
}

export async function updateTeam(ctx: SessionContext, teamId: string, input: UpdateTeamInput): Promise<void> {
  const data = parseInput(updateTeamSchema, input);
  try {
    await db.transaction(async (tx) => {
      const t = await loadManageableTeam(ctx, tx, teamId);
      await tx
        .update(teams)
        .set({ name: data.name, division: data.division, color: data.color, isActive: data.isActive })
        .where(eq(teams.id, t.id));
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "team.updated",
          targetType: "team",
          targetId: t.id,
          metadata: {
            from: { name: t.name, division: t.division, color: t.color, isActive: t.isActive },
            to: { name: data.name, division: data.division, color: data.color, isActive: data.isActive },
          },
        },
        tx
      );
    });
  } catch (e) {
    if (pgViolation(e).code === "23505") throw new DalError("INVALID", `A team named "${data.name}" already exists in this season.`);
    throw e;
  }
}

/** Revokes the old public ICS feed URL and issues a new one. The token itself is never audited or returned. */
export async function rotateCalendarToken(ctx: SessionContext, teamId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await loadManageableTeam(ctx, tx, teamId);
    await tx.update(teams).set({ calendarToken: randomBytes(32).toString("base64url") }).where(eq(teams.id, t.id));
    await writeAudit({ actorUserId: ctx.userId, action: "team.calendar_token_rotated", targetType: "team", targetId: t.id }, tx);
  });
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
async function selectUnassigned(tx: DbOrTx, seasonId: string): Promise<UnassignedRegistration[]> {
  const [season] = await tx.select({ form: seasons.customFormSchema }).from(seasons).where(eq(seasons.id, seasonId)).limit(1);
  const labelFor = new Map((season?.form ?? []).map((f) => [f.key, f.label]));
  const rows = await tx
    .select({
      registrationId: registrations.id,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      dateOfBirth: athletes.dateOfBirth,
      customAnswers: registrations.customAnswers,
    })
    .from(registrations)
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .where(
      and(
        eq(registrations.seasonId, seasonId),
        isNull(registrations.deletedAt),
        sql`not exists (select 1 from ${teamPlayers} tp where tp.registration_id = ${registrations.id} and tp.removed_at is null)`
      )
    )
    .orderBy(asc(athletes.lastName), asc(athletes.firstName));
  return rows.map((r) => ({
    registrationId: r.registrationId,
    athleteName: `${r.firstName} ${r.lastName}`.trim(),
    age: ageFromDob(r.dateOfBirth),
    answers: Object.entries(r.customAnswers ?? {})
      .map(([key, v]) => ({ key, label: labelFor.get(key) ?? key, value: renderAnswer(v) }))
      .filter((a) => a.value !== ""),
  }));
}

export async function listUnassignedRegistrations(ctx: SessionContext, seasonId: string): Promise<UnassignedRegistration[]> {
  const season = await loadManageableSeason(ctx, db, seasonId);
  return selectUnassigned(db, season.seasonId);
}

/**
 * Put live registrations on a team. A registration already on another team is
 * MOVED (old row ended, new row inserted, history kept). Registration rows are
 * locked FOR UPDATE (same order every time) so concurrent assigners serialise;
 * the partial unique index on team_players is the backstop.
 */
export async function assignPlayers(ctx: SessionContext, teamId: string, registrationIds: string[]): Promise<AssignResult> {
  const ids = parseInput(registrationIdsSchema, registrationIds);
  try {
    return await db.transaction(async (tx) => {
      const team = await loadManageableTeam(ctx, tx, teamId);
      if (!team.isActive) throw new DalError("INVALID", "This team is inactive. Reactivate it before adding players.");

      const regs = await tx
        .select({ id: registrations.id, seasonId: registrations.seasonId, deletedAt: registrations.deletedAt })
        .from(registrations)
        .where(inArray(registrations.id, ids))
        .orderBy(asc(registrations.id))
        .for("update");
      if (regs.length !== ids.length) throw new DalError("INVALID", "One or more registrations were not found.");
      if (regs.some((r) => r.seasonId !== team.seasonId)) {
        throw new DalError("INVALID", "Every player must be registered for this team's season.");
      }
      if (regs.some((r) => r.deletedAt)) {
        throw new DalError("INVALID", "A cancelled registration cannot be put on a team. Refresh the list and try again.");
      }

      // Re-read the live rows now that the registrations are locked.
      const live = await tx
        .select({ id: teamPlayers.id, teamId: teamPlayers.teamId, registrationId: teamPlayers.registrationId })
        .from(teamPlayers)
        .where(and(inArray(teamPlayers.registrationId, ids), isNull(teamPlayers.removedAt)));
      const liveByReg = new Map(live.map((l) => [l.registrationId, l]));

      const now = new Date();
      const result: AssignResult = { added: 0, moved: 0, unchanged: 0 };
      for (const regId of ids) {
        const existing = liveByReg.get(regId);
        if (existing?.teamId === team.id) {
          result.unchanged += 1;
          continue;
        }
        if (existing) {
          await tx
            .update(teamPlayers)
            .set({ removedAt: now, removedByUserId: ctx.userId })
            .where(eq(teamPlayers.id, existing.id));
          await writeAudit(
            {
              actorUserId: ctx.userId,
              action: "team.player_removed",
              targetType: "team",
              targetId: existing.teamId,
              metadata: { registrationId: regId, teamPlayerId: existing.id, reason: "moved", movedToTeamId: team.id },
            },
            tx
          );
          result.moved += 1;
        } else {
          result.added += 1;
        }
        const [row] = await tx
          .insert(teamPlayers)
          .values({ teamId: team.id, registrationId: regId, addedByUserId: ctx.userId, addedAt: now })
          .returning({ id: teamPlayers.id });
        await writeAudit(
          {
            actorUserId: ctx.userId,
            action: "team.player_added",
            targetType: "team",
            targetId: team.id,
            metadata: {
              registrationId: regId,
              teamPlayerId: row.id,
              ...(existing ? { movedFromTeamId: existing.teamId } : {}),
            },
          },
          tx
        );
      }
      return result;
    });
  } catch (e) {
    if (e instanceof DalError) throw e;
    if (pgViolation(e).code === "23505") {
      throw new DalError("INVALID", "Someone else just assigned one of these players. Refresh and try again.");
    }
    throw e;
  }
}

async function loadLiveTeamPlayer(tx: DbTx, teamPlayerId: string) {
  const id = parseId(teamPlayerId, "Player");
  const [row] = await tx
    .select({ id: teamPlayers.id, teamId: teamPlayers.teamId, registrationId: teamPlayers.registrationId, removedAt: teamPlayers.removedAt })
    .from(teamPlayers)
    .where(eq(teamPlayers.id, id))
    .for("update")
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Player not found.");
  return row;
}

export async function removePlayer(ctx: SessionContext, teamPlayerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadLiveTeamPlayer(tx, teamPlayerId);
    const team = await loadManageableTeam(ctx, tx, row.teamId);
    if (row.removedAt) throw new DalError("INVALID", "This player is already off the team.");
    await tx.update(teamPlayers).set({ removedAt: new Date(), removedByUserId: ctx.userId }).where(eq(teamPlayers.id, row.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "team.player_removed",
        targetType: "team",
        targetId: team.id,
        metadata: { registrationId: row.registrationId, teamPlayerId: row.id, reason: "removed" },
      },
      tx
    );
  });
}

export async function setJerseyNumber(ctx: SessionContext, teamPlayerId: string, jersey: string): Promise<void> {
  const value = parseInput(jerseySchema, jersey);
  await db.transaction(async (tx) => {
    const row = await loadLiveTeamPlayer(tx, teamPlayerId);
    const team = await loadManageableTeam(ctx, tx, row.teamId);
    if (row.removedAt) throw new DalError("INVALID", "This player is no longer on the team.");
    await tx.update(teamPlayers).set({ jerseyNumber: value }).where(eq(teamPlayers.id, row.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "team.updated",
        targetType: "team",
        targetId: team.id,
        metadata: { teamPlayerId: row.id, registrationId: row.registrationId, jerseyNumber: value },
      },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export async function addTeamStaff(ctx: SessionContext, teamId: string, input: TeamStaffInput): Promise<AddStaffResult> {
  const data = parseInput(teamStaffInputSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const team = await loadManageableTeam(ctx, tx, teamId);
      const [user] = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${data.email}`, isNull(users.deletedAt)))
        .limit(1);
      if (!user) {
        throw new DalError("INVALID", "No account uses that email yet. Ask them to sign in to GBYS once, then add them.");
      }
      const [dup] = await tx
        .select({ id: teamStaff.id })
        .from(teamStaff)
        .where(and(eq(teamStaff.teamId, team.id), eq(teamStaff.userId, user.id), isNull(teamStaff.removedAt)))
        .limit(1);
      if (dup) throw new DalError("INVALID", `${user.name} is already on this team's staff.`);

      const [row] = await tx
        .insert(teamStaff)
        .values({ teamId: team.id, userId: user.id, role: data.role, addedByUserId: ctx.userId })
        .returning({ id: teamStaff.id });
      const readiness = (await readinessFor(tx, [user.id], team.requiredCredentialIds)).get(user.id)!;
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "team.staff_added",
          targetType: "team",
          targetId: team.id,
          metadata: { userId: user.id, role: data.role, credentialsReady: readiness.ready },
        },
        tx
      );
      return { teamStaffId: row.id, name: user.name, readiness };
    });
  } catch (e) {
    if (e instanceof DalError) throw e;
    if (pgViolation(e).code === "23505") throw new DalError("INVALID", "That person is already on this team's staff.");
    throw e;
  }
}

export async function removeTeamStaff(ctx: SessionContext, teamStaffId: string): Promise<void> {
  const id = parseId(teamStaffId, "Staff member");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: teamStaff.id, teamId: teamStaff.teamId, userId: teamStaff.userId, role: teamStaff.role, removedAt: teamStaff.removedAt })
      .from(teamStaff)
      .where(eq(teamStaff.id, id))
      .for("update")
      .limit(1);
    if (!row) throw new DalError("NOT_FOUND", "Staff member not found.");
    const team = await loadManageableTeam(ctx, tx, row.teamId);
    if (row.removedAt) throw new DalError("INVALID", "This person is already off the team.");
    await tx.update(teamStaff).set({ removedAt: new Date(), removedByUserId: ctx.userId }).where(eq(teamStaff.id, row.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "team.staff_removed",
        targetType: "team",
        targetId: team.id,
        metadata: { userId: row.userId, role: row.role },
      },
      tx
    );
  });
}

const COACH_ROLES = ["head_coach", "assistant_coach", "team_manager"] as const;

/**
 * People worth adding: coaches / team managers in this program's roles, or with an
 * active volunteer role that grants a coaching role (or is named "...coach...").
 * Excludes anyone already live on this team.
 */
export async function suggestTeamStaff(ctx: SessionContext, teamId: string): Promise<StaffSuggestion[]> {
  const team = await loadManageableTeam(ctx, db, teamId);

  const fromRoles = await db
    .select({ userId: users.id, name: users.name, email: users.email, role: programRoles.role })
    .from(programRoles)
    .innerJoin(users, eq(users.id, programRoles.userId))
    .where(
      and(
        eq(programRoles.programId, team.programId),
        inArray(programRoles.role, [...COACH_ROLES]),
        isNull(users.deletedAt),
        or(isNull(programRoles.seasonId), eq(programRoles.seasonId, team.seasonId))
      )
    );
  const fromVolunteer = await db
    .select({ userId: users.id, name: users.name, email: users.email, grants: volunteerRoles.grantsProgramRole, roleName: volunteerRoles.name })
    .from(volunteerRoleAssignments)
    .innerJoin(volunteerRoles, eq(volunteerRoles.id, volunteerRoleAssignments.roleId))
    .innerJoin(users, eq(users.id, volunteerRoleAssignments.userId))
    .where(
      and(
        eq(volunteerRoles.programId, team.programId),
        eq(volunteerRoleAssignments.status, "active"),
        isNull(users.deletedAt),
        or(
          inArray(volunteerRoles.grantsProgramRole, [...COACH_ROLES]),
          ilike(volunteerRoles.name, "%coach%")
        ),
        or(isNull(volunteerRoleAssignments.seasonId), eq(volunteerRoleAssignments.seasonId, team.seasonId))
      )
    );
  const live = await db
    .select({ userId: teamStaff.userId })
    .from(teamStaff)
    .where(and(eq(teamStaff.teamId, team.id), isNull(teamStaff.removedAt)));
  const taken = new Set(live.map((l) => l.userId));

  const out = new Map<string, StaffSuggestion>();
  const rankRole = (r: TeamStaffRoleValue) => (r === "head_coach" ? 0 : r === "assistant_coach" ? 1 : 2);
  const consider = (userId: string, name: string, email: string, role: TeamStaffRoleValue, source: string) => {
    if (taken.has(userId)) return;
    const prev = out.get(userId);
    if (!prev || rankRole(role) < rankRole(prev.suggestedRole)) out.set(userId, { userId, name, email, suggestedRole: role, source });
  };
  for (const r of fromRoles) {
    if (r.role === "head_coach" || r.role === "assistant_coach" || r.role === "team_manager") {
      consider(r.userId, r.name, r.email, r.role, "Program role");
    }
  }
  for (const v of fromVolunteer) {
    const role: TeamStaffRoleValue =
      v.grants === "head_coach" || v.grants === "assistant_coach" || v.grants === "team_manager" ? v.grants : "assistant_coach";
    consider(v.userId, v.name, v.email, role, `Volunteer role: ${v.roleName}`);
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Season team builder payload
// ---------------------------------------------------------------------------
export async function getTeamBuilder(ctx: SessionContext, seasonId: string): Promise<TeamBuilderData> {
  const { requiredCredentialIds, ...header } = await loadManageableSeason(ctx, db, seasonId);
  const base = await listSeasonTeams(ctx, header.seasonId);
  const teamIds = base.teams.map((t) => t.id);

  const playerRows = teamIds.length
    ? await db
        .select({
          teamId: teamPlayers.teamId,
          teamPlayerId: teamPlayers.id,
          registrationId: teamPlayers.registrationId,
          firstName: athletes.firstName,
          lastName: athletes.lastName,
          dateOfBirth: athletes.dateOfBirth,
          jerseyNumber: teamPlayers.jerseyNumber,
        })
        .from(teamPlayers)
        .innerJoin(registrations, eq(registrations.id, teamPlayers.registrationId))
        .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
        .where(and(inArray(teamPlayers.teamId, teamIds), isNull(teamPlayers.removedAt), isNull(registrations.deletedAt)))
        .orderBy(asc(athletes.lastName), asc(athletes.firstName))
    : [];
  const playersByTeam = new Map<string, BuilderPlayer[]>();
  for (const p of playerRows) {
    const list = playersByTeam.get(p.teamId) ?? [];
    list.push({
      teamPlayerId: p.teamPlayerId,
      registrationId: p.registrationId,
      athleteName: `${p.firstName} ${p.lastName}`.trim(),
      age: ageFromDob(p.dateOfBirth),
      jerseyNumber: p.jerseyNumber,
    });
    playersByTeam.set(p.teamId, list);
  }
  const staffByTeam = await loadStaff(db, teamIds, new Map(teamIds.map((id) => [id, requiredCredentialIds])));
  const unassigned = await selectUnassigned(db, header.seasonId);

  return {
    header,
    teams: base.teams.map((t) => ({ ...t, players: playersByTeam.get(t.id) ?? [], staff: staffByTeam.get(t.id) ?? [] })),
    unassigned,
    requiredCredentialCount: requiredCredentialIds.length,
  };
}

// ---------------------------------------------------------------------------
// Team overview (no medical data)
// ---------------------------------------------------------------------------
export async function getTeamOverview(ctx: SessionContext, teamId: string): Promise<TeamOverview> {
  const team = await loadTeam(db, teamId);
  if (!team || !canViewTeam(ctx, team)) throw new DalError("NOT_FOUND", "Team not found.");
  if (!team.programActive && !isBoard(ctx)) throw new DalError("NOT_FOUND", "Team not found.");
  const canManage = canManageProgram(ctx, team.programId);

  const staffMap = await loadStaff(db, [team.id], canManage ? new Map([[team.id, team.requiredCredentialIds]]) : null);

  const rows = await db
    .select({
      teamPlayerId: teamPlayers.id,
      registrationId: teamPlayers.registrationId,
      athleteId: athletes.id,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      dateOfBirth: athletes.dateOfBirth,
      jerseyNumber: teamPlayers.jerseyNumber,
      photoObjectKey: athletes.photoObjectKey,
      photoUpdatedAt: athletes.photoUpdatedAt,
    })
    .from(teamPlayers)
    .innerJoin(registrations, eq(registrations.id, teamPlayers.registrationId))
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .where(and(eq(teamPlayers.teamId, team.id), isNull(teamPlayers.removedAt), isNull(registrations.deletedAt), isNull(athletes.deletedAt)))
    .orderBy(asc(athletes.lastName), asc(athletes.firstName));

  const athleteIds = rows.map((r) => r.athleteId);
  const guardianRows = athleteIds.length
    ? await db
        .select({ athleteId: householdGuardians.athleteId, name: users.name, phone: users.phone })
        .from(householdGuardians)
        .innerJoin(users, eq(users.id, householdGuardians.userId))
        .where(and(inArray(householdGuardians.athleteId, athleteIds), eq(householdGuardians.receivesComms, true), isNull(users.deletedAt)))
        .orderBy(asc(users.name))
    : [];
  const guardiansByAthlete = new Map<string, { name: string; phone: string | null }[]>();
  for (const g of guardianRows) {
    const list = guardiansByAthlete.get(g.athleteId) ?? [];
    list.push({ name: g.name, phone: g.phone });
    guardiansByAthlete.set(g.athleteId, list);
  }

  const roster: OverviewPlayer[] = rows.map((r) => ({
    teamPlayerId: r.teamPlayerId,
    registrationId: r.registrationId,
    athleteName: `${r.firstName} ${r.lastName}`.trim(),
    age: ageFromDob(r.dateOfBirth),
    jerseyNumber: r.jerseyNumber,
    photoUrl: athletePhotoUrl({ id: r.athleteId, photoObjectKey: r.photoObjectKey, photoUpdatedAt: r.photoUpdatedAt }),
    guardians: guardiansByAthlete.get(r.athleteId) ?? [],
  }));

  await writeAudit({
    actorUserId: ctx.userId,
    action: "roster.viewed",
    targetType: "team",
    targetId: team.id,
    metadata: { teamId: team.id, rowCount: roster.length },
  });

  const base = `/programs/${team.programSlug}/teams/${team.id}`;
  return {
    team: { id: team.id, name: team.name, division: team.division, color: team.color, isActive: team.isActive },
    header: {
      seasonId: team.seasonId,
      seasonName: team.seasonName,
      programId: team.programId,
      programName: team.programName,
      programSlug: team.programSlug,
      programActive: team.programActive,
    },
    canManage,
    isBoard: isBoard(ctx),
    staff: staffMap.get(team.id) ?? [],
    roster,
    links: {
      overview: base,
      schedule: `${base}/schedule`,
      emergency: `${base}/emergency`,
      builder: canManage ? `/programs/${team.programSlug}/seasons/${team.seasonId}/teams` : null,
    },
  };
}

// ---------------------------------------------------------------------------
// My teams
// ---------------------------------------------------------------------------
export async function listMyTeams(ctx: SessionContext): Promise<MyTeamRow[]> {
  const adminProgramIds = [...new Set(ctx.programRoles.filter((g) => g.role === "program_admin").map((g) => g.programId))];
  const staffTeamIds = ctx.teamStaff.map((t) => t.teamId);
  const board = isBoard(ctx);

  const scope = board
    ? undefined
    : or(
        staffTeamIds.length ? inArray(teams.id, staffTeamIds) : undefined,
        adminProgramIds.length ? inArray(teams.programId, adminProgramIds) : undefined
      );
  if (!board && !scope) return [];

  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      division: teams.division,
      color: teams.color,
      programName: programs.name,
      programSlug: programs.slug,
      seasonName: seasons.name,
      playerCount: sql<number>`(select count(*)::int from ${teamPlayers} tp inner join ${registrations} r on r.id = tp.registration_id where tp.team_id = teams.id and tp.removed_at is null and r.deleted_at is null)`,
    })
    .from(teams)
    .innerJoin(programs, eq(programs.id, teams.programId))
    .innerJoin(seasons, eq(seasons.id, teams.seasonId))
    .where(and(eq(teams.isActive, true), eq(programs.isActive, true), isNull(programs.deletedAt), scope))
    .orderBy(asc(programs.name), asc(seasons.name), asc(sql`lower(${teams.name})`));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  // Next scheduled event per team (S2 owns writes; read directly).
  const nextRows = await db
    .selectDistinctOn([teamEvents.teamId], {
      teamId: teamEvents.teamId,
      id: teamEvents.id,
      kind: teamEvents.kind,
      title: teamEvents.title,
      opponent: teamEvents.opponent,
      startsAt: teamEvents.startsAt,
      endsAt: teamEvents.endsAt,
    })
    .from(teamEvents)
    .where(and(inArray(teamEvents.teamId, ids), eq(teamEvents.status, "scheduled"), gt(teamEvents.endsAt, new Date())))
    .orderBy(teamEvents.teamId, asc(teamEvents.startsAt));
  const nextByTeam = new Map(nextRows.map((n) => [n.teamId, n]));

  return rows.map((r) => {
    const n = nextByTeam.get(r.id);
    return {
      ...r,
      myRoles: ctx.teamStaff.filter((t) => t.teamId === r.id).map((t) => t.role),
      nextEvent: n
        ? { id: n.id, kind: n.kind, title: n.title, opponent: n.opponent, startsAt: n.startsAt, endsAt: n.endsAt }
        : null,
    };
  });
}

