import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { credentialDefinitions, programs, userCredentials } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  createCredentialTypeSchema,
  credentialIdSchema,
  updateCredentialTypeSchema,
  type CreateCredentialTypeInput,
  type UpdateCredentialTypeInput,
} from "@/lib/validation/credential-types";
import { DalError, isBoard, type SessionContext } from "./context";

export interface CredentialTypeAdminRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultValidityMonths: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  totalCredentials: number;
  verifiedCredentials: number;
  requiredByPrograms: { id: string; name: string }[];
}

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function programsRequiring(id: string, tx: Pick<typeof db, "select"> = db) {
  return tx
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(sql`${programs.deletedAt} is null and ${programs.requiredCredentialIds} @> ${JSON.stringify([id])}::jsonb`)
    .orderBy(asc(programs.name));
}

/** All types (active and archived) with usage counts. Board only. */
export async function listCredentialTypesAdmin(ctx: SessionContext): Promise<CredentialTypeAdminRow[]> {
  requireBoard(ctx);
  const [defs, counts, progs] = await Promise.all([
    db.select().from(credentialDefinitions).orderBy(asc(credentialDefinitions.name)),
    db
      .select({
        definitionId: userCredentials.definitionId,
        total: sql<number>`count(*)`.mapWith(Number),
        verified: sql<number>`count(*) filter (where ${userCredentials.status} = 'verified')`.mapWith(Number),
      })
      .from(userCredentials)
      .groupBy(userCredentials.definitionId),
    db
      .select({ id: programs.id, name: programs.name, required: programs.requiredCredentialIds })
      .from(programs)
      .where(sql`${programs.deletedAt} is null`)
      .orderBy(asc(programs.name)),
  ]);
  const byDef = new Map(counts.map((c) => [c.definitionId, c]));
  return defs.map((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    description: d.description,
    defaultValidityMonths: d.defaultValidityMonths,
    isActive: d.isActive,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    totalCredentials: byDef.get(d.id)?.total ?? 0,
    verifiedCredentials: byDef.get(d.id)?.verified ?? 0,
    requiredByPrograms: progs.filter((p) => p.required.includes(d.id)).map((p) => ({ id: p.id, name: p.name })),
  }));
}

export async function createCredentialType(
  ctx: SessionContext,
  input: CreateCredentialTypeInput
): Promise<{ id: string }> {
  requireBoard(ctx);
  const data = createCredentialTypeSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(credentialDefinitions)
        .values({
          code: data.code,
          name: data.name,
          description: data.description,
          defaultValidityMonths: data.defaultValidityMonths,
        })
        .returning({ id: credentialDefinitions.id });
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "credential_definition.created",
          targetType: "credential_definition",
          targetId: row.id,
          metadata: { code: data.code, name: data.name, defaultValidityMonths: data.defaultValidityMonths },
        },
        tx
      );
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DalError("INVALID", "A credential type with that code already exists.");
    throw err;
  }
}

/** The code is immutable and deliberately not accepted here. Validity changes apply to new submissions only. */
export async function updateCredentialType(
  ctx: SessionContext,
  id: string,
  input: UpdateCredentialTypeInput
): Promise<{ changed: string[] }> {
  requireBoard(ctx);
  const parsedId = credentialIdSchema.safeParse(id);
  if (!parsedId.success) throw new DalError("NOT_FOUND", "Credential type not found.");
  const data = updateCredentialTypeSchema.parse(input);

  return db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(credentialDefinitions)
      .where(eq(credentialDefinitions.id, parsedId.data))
      .for("update")
      .limit(1);
    if (!old) throw new DalError("NOT_FOUND", "Credential type not found.");

    const changed: string[] = [];
    if (old.name !== data.name) changed.push("name");
    if ((old.description ?? null) !== data.description) changed.push("description");
    if (old.defaultValidityMonths !== data.defaultValidityMonths) changed.push("defaultValidityMonths");
    if (changed.length === 0) return { changed };

    await tx
      .update(credentialDefinitions)
      .set({ name: data.name, description: data.description, defaultValidityMonths: data.defaultValidityMonths })
      .where(eq(credentialDefinitions.id, old.id));

    const metadata: Record<string, unknown> = { code: old.code, fields: changed };
    if (changed.includes("defaultValidityMonths")) {
      metadata.defaultValidityMonths = { from: old.defaultValidityMonths, to: data.defaultValidityMonths };
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "credential_definition.updated",
        targetType: "credential_definition",
        targetId: old.id,
        metadata,
      },
      tx
    );
    return { changed };
  });
}

async function setActive(ctx: SessionContext, id: string, isActive: boolean) {
  requireBoard(ctx);
  const parsedId = credentialIdSchema.safeParse(id);
  if (!parsedId.success) throw new DalError("NOT_FOUND", "Credential type not found.");

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(credentialDefinitions)
      .where(eq(credentialDefinitions.id, parsedId.data))
      .for("update")
      .limit(1);
    if (!row) throw new DalError("NOT_FOUND", "Credential type not found.");
    const requiredBy = await programsRequiring(row.id, tx);
    if (row.isActive === isActive) return { requiredByPrograms: requiredBy };

    await tx.update(credentialDefinitions).set({ isActive }).where(eq(credentialDefinitions.id, row.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: isActive ? "credential_definition.restored" : "credential_definition.archived",
        targetType: "credential_definition",
        targetId: row.id,
        metadata: {
          code: row.code,
          ...(isActive ? {} : { stillRequiredByPrograms: requiredBy.map((p) => p.name) }),
        },
      },
      tx
    );
    return { requiredByPrograms: requiredBy };
  });
}

/** Archive hides the type from new submissions; programs that require it are returned as a warning. */
export async function archiveCredentialType(ctx: SessionContext, id: string) {
  return setActive(ctx, id, false);
}

export async function restoreCredentialType(ctx: SessionContext, id: string) {
  return setActive(ctx, id, true);
}
