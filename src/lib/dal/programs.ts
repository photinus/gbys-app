import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { credentialDefinitions, programRoles, programs, seasons, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  createProgramSchema,
  grantRoleSchema,
  programIdSchema,
  updateProgramSchema,
  type CreateProgramInput,
  type GrantRoleInput,
  type UpdateProgramInput,
} from "@/lib/validation/programs";
import { DalError, isBoard, type ProgramRole, type SessionContext } from "./context";

export interface ProgramOption {
  id: string;
  name: string;
  slug: string;
  sport: string;
}

/**
 * Active programs for dropdowns/filters. Non-sensitive: any signed-in user.
 * (Shared contract for Sprint 2 workers. W-Programs extends this file.)
 */
export async function listActivePrograms(ctx: SessionContext): Promise<ProgramOption[]> {
  void ctx;
  return db
    .select({ id: programs.id, name: programs.name, slug: programs.slug, sport: programs.sport })
    .from(programs)
    .where(and(eq(programs.isActive, true), isNull(programs.deletedAt)))
    .orderBy(asc(programs.name));
}

// ---------------------------------------------------------------------------
// Board-only program administration (Sprint 2, WA)
// ---------------------------------------------------------------------------

export interface ProgramAdminRow {
  id: string;
  slug: string;
  name: string;
  sport: string;
  description: string | null;
  isIndependentPartner: boolean;
  isActive: boolean;
  stripeOnboardingComplete: boolean;
  stripeConnected: boolean;
  requiredCredentialIds: string[];
  createdAt: Date;
}

export interface ProgramListRow extends ProgramAdminRow {
  roleCount: number;
  coachCount: number;
}

export interface ProgramRoleRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: ProgramRole;
  seasonId: string | null;
  seasonName: string | null;
  createdAt: Date;
}

export interface CredentialOption {
  id: string;
  code: string;
  name: string;
}

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

const adminColumns = {
  id: programs.id,
  slug: programs.slug,
  name: programs.name,
  sport: programs.sport,
  description: programs.description,
  isIndependentPartner: programs.isIndependentPartner,
  isActive: programs.isActive,
  stripeOnboardingComplete: programs.stripeOnboardingComplete,
  stripeConnected: sql<boolean>`${programs.stripeAccountId} is not null`,
  requiredCredentialIds: programs.requiredCredentialIds,
  createdAt: programs.createdAt,
};

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** Credential definitions for the required-credentials picker. Board only. */
export async function listCredentialOptions(ctx: SessionContext): Promise<CredentialOption[]> {
  requireBoard(ctx);
  return db
    .select({ id: credentialDefinitions.id, code: credentialDefinitions.code, name: credentialDefinitions.name })
    .from(credentialDefinitions)
    .orderBy(asc(credentialDefinitions.name));
}

/** All non-deleted programs (including inactive) with role counts. */
export async function listProgramsAdmin(ctx: SessionContext): Promise<ProgramListRow[]> {
  requireBoard(ctx);
  const rows = await db
    .select(adminColumns)
    .from(programs)
    .where(isNull(programs.deletedAt))
    .orderBy(desc(programs.isActive), asc(programs.name));

  const counts = await db
    .select({
      programId: programRoles.programId,
      total: count(),
      coaches: sql<number>`count(*) filter (where ${programRoles.role} in ('head_coach','assistant_coach'))`.mapWith(Number),
    })
    .from(programRoles)
    .groupBy(programRoles.programId);
  const byProgram = new Map(counts.map((c) => [c.programId, c]));

  return rows.map((r) => ({
    ...r,
    roleCount: byProgram.get(r.id)?.total ?? 0,
    coachCount: byProgram.get(r.id)?.coaches ?? 0,
  }));
}

export async function getProgramAdmin(ctx: SessionContext, id: string): Promise<ProgramAdminRow> {
  requireBoard(ctx);
  const parsed = programIdSchema.safeParse(id);
  if (!parsed.success) throw new DalError("NOT_FOUND", "Program not found.");
  const [row] = await db
    .select(adminColumns)
    .from(programs)
    .where(and(eq(programs.id, parsed.data), isNull(programs.deletedAt)))
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Program not found.");
  return row;
}

async function assertCredentialIdsExist(ids: string[]) {
  if (ids.length === 0) return;
  const found = await db
    .select({ id: credentialDefinitions.id })
    .from(credentialDefinitions)
    .where(inArray(credentialDefinitions.id, ids));
  if (found.length !== ids.length) throw new DalError("INVALID", "One of the selected credentials does not exist.");
}

export async function createProgram(ctx: SessionContext, input: CreateProgramInput): Promise<{ id: string }> {
  requireBoard(ctx);
  const data = createProgramSchema.parse(input);
  await assertCredentialIdsExist(data.requiredCredentialIds);

  try {
    return await db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: programs.id }).from(programs).where(eq(programs.slug, data.slug)).limit(1);
      if (dup) throw new DalError("INVALID", "That slug is already used by another program.");

      const [row] = await tx
        .insert(programs)
        .values({
          slug: data.slug,
          name: data.name,
          sport: data.sport,
          description: data.description,
          isIndependentPartner: data.isIndependentPartner,
          requiredCredentialIds: data.requiredCredentialIds,
        })
        .returning({ id: programs.id });
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "program.created",
          targetType: "program",
          targetId: row.id,
          metadata: { slug: data.slug, name: data.name, isIndependentPartner: data.isIndependentPartner },
        },
        tx
      );
      return { id: row.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DalError("INVALID", "That slug is already used by another program.");
    throw err;
  }
}

export async function updateProgram(ctx: SessionContext, id: string, input: UpdateProgramInput): Promise<void> {
  requireBoard(ctx);
  const programId = programIdSchema.safeParse(id);
  if (!programId.success) throw new DalError("NOT_FOUND", "Program not found.");
  const data = updateProgramSchema.parse(input);
  await assertCredentialIdsExist(data.requiredCredentialIds);

  try {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(programs)
        .where(and(eq(programs.id, programId.data), isNull(programs.deletedAt)))
        .for("update")
        .limit(1);
      if (!before) throw new DalError("NOT_FOUND", "Program not found.");

      if (data.slug !== before.slug) {
        const [dup] = await tx.select({ id: programs.id }).from(programs).where(eq(programs.slug, data.slug)).limit(1);
        if (dup) throw new DalError("INVALID", "That slug is already used by another program.");
      }

      await tx
        .update(programs)
        .set({
          slug: data.slug,
          name: data.name,
          sport: data.sport,
          description: data.description,
          isIndependentPartner: data.isIndependentPartner,
          requiredCredentialIds: data.requiredCredentialIds,
          isActive: data.isActive,
        })
        .where(eq(programs.id, programId.data));

      const changed: string[] = [];
      if (before.slug !== data.slug) changed.push("slug");
      if (before.name !== data.name) changed.push("name");
      if (before.sport !== data.sport) changed.push("sport");
      if ((before.description ?? null) !== data.description) changed.push("description");
      if (before.isIndependentPartner !== data.isIndependentPartner) changed.push("isIndependentPartner");
      if (before.isActive !== data.isActive) changed.push("isActive");
      if (JSON.stringify([...before.requiredCredentialIds].sort()) !== JSON.stringify([...data.requiredCredentialIds].sort()))
        changed.push("requiredCredentialIds");

      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "program.updated",
          targetType: "program",
          targetId: programId.data,
          metadata: { changed, isActive: data.isActive },
        },
        tx
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DalError("INVALID", "That slug is already used by another program.");
    throw err;
  }
}

export async function listProgramRoles(ctx: SessionContext, programId: string): Promise<ProgramRoleRow[]> {
  requireBoard(ctx);
  const parsed = programIdSchema.safeParse(programId);
  if (!parsed.success) throw new DalError("NOT_FOUND", "Program not found.");
  return db
    .select({
      id: programRoles.id,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      role: programRoles.role,
      seasonId: programRoles.seasonId,
      seasonName: seasons.name,
      createdAt: programRoles.createdAt,
    })
    .from(programRoles)
    .innerJoin(users, eq(users.id, programRoles.userId))
    .leftJoin(seasons, eq(seasons.id, programRoles.seasonId))
    .where(eq(programRoles.programId, parsed.data))
    .orderBy(asc(programRoles.role), asc(users.name), asc(users.email));
}

export async function grantProgramRole(ctx: SessionContext, input: GrantRoleInput): Promise<{ id: string }> {
  requireBoard(ctx);
  const data = grantRoleSchema.parse(input);

  return db.transaction(async (tx) => {
    const [program] = await tx
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(and(eq(programs.id, data.programId), isNull(programs.deletedAt)))
      .limit(1);
    if (!program) throw new DalError("NOT_FOUND", "Program not found.");

    const [user] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${data.email}`, isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw new DalError("INVALID", "Ask them to sign in once first.");

    // Serialize concurrent grants of the same (user, program, role).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`program_role:${program.id}:${user.id}:${data.role}`}))`);
    const [dup] = await tx
      .select({ id: programRoles.id })
      .from(programRoles)
      .where(
        and(
          eq(programRoles.programId, program.id),
          eq(programRoles.userId, user.id),
          eq(programRoles.role, data.role)
        )
      )
      .limit(1);
    if (dup) throw new DalError("INVALID", "That person already has this role in this program.");

    const [row] = await tx
      .insert(programRoles)
      .values({ programId: program.id, userId: user.id, role: data.role })
      .returning({ id: programRoles.id });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "program_role.granted",
        targetType: "program_role",
        targetId: row.id,
        metadata: { programId: program.id, programName: program.name, userId: user.id, email: user.email, role: data.role },
      },
      tx
    );
    return { id: row.id };
  });
}

export async function revokeProgramRole(ctx: SessionContext, roleId: string): Promise<void> {
  requireBoard(ctx);
  const parsed = programIdSchema.safeParse(roleId);
  if (!parsed.success) throw new DalError("NOT_FOUND", "Role not found.");

  await db.transaction(async (tx) => {
    const [role] = await tx
      .select({
        id: programRoles.id,
        programId: programRoles.programId,
        userId: programRoles.userId,
        role: programRoles.role,
        email: users.email,
      })
      .from(programRoles)
      .innerJoin(users, eq(users.id, programRoles.userId))
      .where(eq(programRoles.id, parsed.data))
      .for("update", { of: programRoles })
      .limit(1);
    if (!role) throw new DalError("NOT_FOUND", "Role not found.");

    await tx.delete(programRoles).where(eq(programRoles.id, role.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "program_role.revoked",
        targetType: "program_role",
        targetId: role.id,
        metadata: { programId: role.programId, userId: role.userId, email: role.email, role: role.role },
      },
      tx
    );
  });
}
