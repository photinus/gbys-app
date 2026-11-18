import "server-only";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { ZodType } from "zod";
import { db } from "@/db";
import { programs, registrations, seasons, users, waiverVersions } from "@/db/schema";
import type { CustomFormField } from "@/db/schema/programs";
import { writeAudit } from "@/lib/audit";
import { laDateTimeInputToUtc } from "@/lib/format";
import { hashWaiverBody } from "@/lib/waiver";
import {
  computeSeasonStatus,
  seasonInputSchema,
  waiverVersionInputSchema,
  type SeasonData,
  type SeasonInput,
  type SeasonStatus,
  type WaiverVersionInput,
} from "@/lib/validation/seasons";
import { DalError, isBoard, type SessionContext } from "./context";
import { canManageProgram, canViewRoster, staffProgramIds } from "./permissions";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const forbidden = () => new DalError("FORBIDDEN", "You do not have permission to do that.");

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new DalError("INVALID", r.error.issues[0]?.message ?? "Invalid input.");
  return r.data;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaffProgramRow {
  id: string;
  slug: string;
  name: string;
  sport: string;
  description: string | null;
  isIndependentPartner: boolean;
  canManage: boolean;
  openSeasons: number;
  liveRegistrations: number;
}

export interface HubSeasonRow {
  id: string;
  name: string;
  status: SeasonStatus;
  isActive: boolean;
  startsOn: string | null;
  endsOn: string | null;
  baseFeeCents: number;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  liveRegistrations: number;
  unpaidCount: number;
  waiverTitle: string | null;
  waiverVersion: string | null;
}

export interface ProgramHub {
  program: { id: string; slug: string; name: string; sport: string; description: string | null; isActive: boolean };
  canManage: boolean;
  seasons: HubSeasonRow[];
}

export interface WaiverVersionRow {
  id: string;
  programId: string | null;
  title: string;
  version: string;
  body: string;
  bodyHash: string;
  createdAt: Date;
  createdByName: string | null;
}

export interface SeasonEditorData {
  program: { id: string; slug: string; name: string };
  canManage: boolean;
  canOrgWideWaiver: boolean;
  season: {
    id: string;
    name: string;
    description: string | null;
    startsOn: string | null;
    endsOn: string | null;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
    eligibleBirthDateFrom: string | null;
    eligibleBirthDateTo: string | null;
    baseFeeCents: number;
    waiverVersionId: string | null;
    customFormSchema: CustomFormField[];
    isActive: boolean;
    status: SeasonStatus;
  };
  liveRegistrations: number;
  waiverVersions: WaiverVersionRow[];
}

export interface SeasonFormPreview {
  seasonId: string;
  name: string;
  feeCents: number;
  fields: CustomFormField[];
  waiver: { title: string; version: string; body: string } | null;
}

// ---------------------------------------------------------------------------
// Program hub
// ---------------------------------------------------------------------------

/** Programs where ctx may view the roster (board sees all active programs). */
export async function listMyStaffPrograms(ctx: SessionContext): Promise<StaffProgramRow[]> {
  const ids = staffProgramIds(ctx);
  if (ids !== "all" && ids.length === 0) return [];

  const scope = ids === "all" ? sql`true` : sql`${programs.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`;
  const rows = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      sport: programs.sport,
      description: programs.description,
      isIndependentPartner: programs.isIndependentPartner,
    })
    .from(programs)
    .where(and(isNull(programs.deletedAt), eq(programs.isActive, true), scope))
    .orderBy(asc(programs.name));
  if (rows.length === 0) return [];

  const seasonRows = await db
    .select({
      programId: seasons.programId,
      isActive: seasons.isActive,
      waiverVersionId: seasons.waiverVersionId,
      registrationOpensAt: seasons.registrationOpensAt,
      registrationClosesAt: seasons.registrationClosesAt,
      live: sql<number>`(select count(*) from ${registrations} r where r.season_id = ${seasons.id} and r.deleted_at is null)`.mapWith(Number),
    })
    .from(seasons);
  const now = new Date();
  const agg = new Map<string, { open: number; live: number }>();
  for (const s of seasonRows) {
    const a = agg.get(s.programId) ?? { open: 0, live: 0 };
    if (computeSeasonStatus(s, now) === "open") a.open += 1;
    a.live += s.live;
    agg.set(s.programId, a);
  }

  return rows.map((r) => ({
    ...r,
    canManage: canManageProgram(ctx, r.id),
    openSeasons: agg.get(r.id)?.open ?? 0,
    liveRegistrations: agg.get(r.id)?.live ?? 0,
  }));
}

async function loadProgramBySlug(slug: string) {
  const [program] = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      sport: programs.sport,
      description: programs.description,
      isActive: programs.isActive,
    })
    .from(programs)
    .where(and(eq(programs.slug, slug), isNull(programs.deletedAt)))
    .limit(1);
  if (!program) throw new DalError("NOT_FOUND", "Program not found.");
  return program;
}

export async function getProgramHub(ctx: SessionContext, slug: string): Promise<ProgramHub> {
  const program = await loadProgramBySlug(slug);
  if (!canViewRoster(ctx, program.id)) throw forbidden();

  const rows = await db
    .select({
      id: seasons.id,
      name: seasons.name,
      isActive: seasons.isActive,
      startsOn: seasons.startsOn,
      endsOn: seasons.endsOn,
      baseFeeCents: seasons.baseFeeCents,
      registrationOpensAt: seasons.registrationOpensAt,
      registrationClosesAt: seasons.registrationClosesAt,
      waiverVersionId: seasons.waiverVersionId,
      waiverTitle: waiverVersions.title,
      waiverVersion: waiverVersions.version,
      liveRegistrations: sql<number>`(select count(*) from ${registrations} r where r.season_id = ${seasons.id} and r.deleted_at is null)`.mapWith(Number),
      unpaidCount: sql<number>`(select count(*) from ${registrations} r where r.season_id = ${seasons.id} and r.deleted_at is null and r.payment_status = 'unpaid')`.mapWith(Number),
    })
    .from(seasons)
    .leftJoin(waiverVersions, eq(waiverVersions.id, seasons.waiverVersionId))
    .where(eq(seasons.programId, program.id))
    .orderBy(desc(seasons.createdAt));

  const now = new Date();
  return {
    program,
    canManage: canManageProgram(ctx, program.id),
    seasons: rows.map(({ waiverVersionId, ...r }) => ({
      ...r,
      status: computeSeasonStatus({ ...r, waiverVersionId }, now),
    })),
  };
}

// ---------------------------------------------------------------------------
// Waiver versions (insert-only, invariant 5)
// ---------------------------------------------------------------------------

export async function listWaiverVersions(ctx: SessionContext, programId: string): Promise<WaiverVersionRow[]> {
  if (!uuidRe.test(programId)) throw new DalError("NOT_FOUND", "Program not found.");
  if (!canViewRoster(ctx, programId)) throw forbidden();
  return db
    .select({
      id: waiverVersions.id,
      programId: waiverVersions.programId,
      title: waiverVersions.title,
      version: waiverVersions.version,
      body: waiverVersions.body,
      bodyHash: waiverVersions.bodyHash,
      createdAt: waiverVersions.createdAt,
      createdByName: users.name,
    })
    .from(waiverVersions)
    .leftJoin(users, eq(users.id, waiverVersions.createdByUserId))
    .where(or(eq(waiverVersions.programId, programId), isNull(waiverVersions.programId)))
    .orderBy(desc(waiverVersions.createdAt));
}

/**
 * Inserts a new immutable waiver version. `programId: null` is an org-wide
 * waiver (board only). Existing rows are never updated.
 */
export async function createWaiverVersion(
  ctx: SessionContext,
  input: WaiverVersionInput
): Promise<WaiverVersionRow> {
  const rawProgramId = (input as { programId?: string | null }).programId ?? null;
  const orgWide = rawProgramId === null || rawProgramId === "";
  if (orgWide ? !isBoard(ctx) : !canManageProgram(ctx, rawProgramId as string)) throw forbidden();

  const data = parseInput(waiverVersionInputSchema, input);
  if (data.programId) {
    const [p] = await db
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, data.programId), isNull(programs.deletedAt)))
      .limit(1);
    if (!p) throw new DalError("NOT_FOUND", "Program not found.");
  }

  const bodyHash = hashWaiverBody(data.body);
  return db.transaction(async (tx) => {
    // Serialize concurrent creation of the same (program, title, version).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`waiver_version:${data.programId ?? "org"}:${data.title.toLowerCase()}:${data.version.toLowerCase()}`}))`
    );
    const [dup] = await tx
      .select({ id: waiverVersions.id })
      .from(waiverVersions)
      .where(
        and(
          data.programId ? eq(waiverVersions.programId, data.programId) : isNull(waiverVersions.programId),
          sql`lower(${waiverVersions.title}) = ${data.title.toLowerCase()}`,
          sql`lower(${waiverVersions.version}) = ${data.version.toLowerCase()}`
        )
      )
      .limit(1);
    if (dup) {
      throw new DalError("INVALID", "That waiver title and version already exist. Use a new version label (waivers can't be edited).");
    }

    const [row] = await tx
      .insert(waiverVersions)
      .values({
        programId: data.programId,
        title: data.title,
        version: data.version,
        body: data.body,
        bodyHash,
        createdByUserId: ctx.userId,
      })
      .returning();
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "waiver.version_created",
        targetType: "waiver_version",
        targetId: row.id,
        metadata: { programId: data.programId, title: data.title, version: data.version, bodyHash },
      },
      tx
    );
    return {
      id: row.id,
      programId: row.programId,
      title: row.title,
      version: row.version,
      body: row.body,
      bodyHash: row.bodyHash,
      createdAt: row.createdAt,
      createdByName: ctx.name,
    };
  });
}

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertWaiverUsable(tx: Tx, programId: string, waiverVersionId: string | null) {
  if (!waiverVersionId) return;
  const [w] = await tx
    .select({ programId: waiverVersions.programId })
    .from(waiverVersions)
    .where(eq(waiverVersions.id, waiverVersionId))
    .limit(1);
  if (!w || (w.programId !== null && w.programId !== programId)) {
    throw new DalError("INVALID", "That waiver isn't available to this program.");
  }
}

// jsonb does not preserve key order, so compare fields in a fixed shape.
const canonFields = (fs: CustomFormField[]) =>
  fs.map((f) => [f.key, f.label, f.type, f.required, f.options ?? [], f.placeholder ?? ""]);

function seasonValues(data: SeasonData) {
  return {
    name: data.name,
    description: data.description,
    startsOn: data.startsOn,
    endsOn: data.endsOn,
    registrationOpensAt: data.registrationOpensAt ? laDateTimeInputToUtc(data.registrationOpensAt) : null,
    registrationClosesAt: data.registrationClosesAt ? laDateTimeInputToUtc(data.registrationClosesAt) : null,
    eligibleBirthDateFrom: data.eligibleBirthDateFrom,
    eligibleBirthDateTo: data.eligibleBirthDateTo,
    baseFeeCents: data.baseFeeCents,
    waiverVersionId: data.waiverVersionId,
    customFormSchema: data.customFormSchema as CustomFormField[],
    isActive: data.isActive,
  };
}

export async function createSeason(
  ctx: SessionContext,
  programId: string,
  input: SeasonInput
): Promise<{ id: string }> {
  if (!uuidRe.test(programId)) throw new DalError("NOT_FOUND", "Program not found.");
  if (!canManageProgram(ctx, programId)) throw forbidden();
  const data = parseInput(seasonInputSchema, input);
  const values = seasonValues(data);

  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, programId), isNull(programs.deletedAt)))
      .limit(1);
    if (!p) throw new DalError("NOT_FOUND", "Program not found.");
    await assertWaiverUsable(tx, programId, values.waiverVersionId);

    const [row] = await tx.insert(seasons).values({ programId, ...values }).returning({ id: seasons.id });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "season.created",
        targetType: "season",
        targetId: row.id,
        metadata: {
          programId,
          name: data.name,
          baseFeeCents: data.baseFeeCents,
          fieldCount: data.customFormSchema.length,
          waiverVersionId: data.waiverVersionId,
        },
      },
      tx
    );
    return { id: row.id };
  });
}

export async function updateSeason(ctx: SessionContext, seasonId: string, input: SeasonInput): Promise<void> {
  if (!uuidRe.test(seasonId)) throw new DalError("NOT_FOUND", "Season not found.");
  const [found] = await db
    .select({ programId: seasons.programId })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  if (!found) throw new DalError("NOT_FOUND", "Season not found.");
  if (!canManageProgram(ctx, found.programId)) throw forbidden();

  const data = parseInput(seasonInputSchema, input);
  const values = seasonValues(data);

  await db.transaction(async (tx) => {
    // Same lock registration submission takes, so a registration can't slip in mid-edit.
    const [before] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).for("update").limit(1);
    if (!before) throw new DalError("NOT_FOUND", "Season not found.");
    await assertWaiverUsable(tx, before.programId, values.waiverVersionId);

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(registrations)
      .where(and(eq(registrations.seasonId, seasonId), isNull(registrations.deletedAt)));

    if (n > 0) {
      const oldByKey = new Map(before.customFormSchema.map((f) => [f.key, f]));
      const newByKey = new Map(values.customFormSchema.map((f) => [f.key, f]));
      for (const [key, old] of oldByKey) {
        const next = newByKey.get(key);
        if (!next) {
          throw new DalError(
            "INVALID",
            `"${old.label}" can't be removed or renamed (key "${key}") because ${n} registration${n === 1 ? " has" : "s have"} answered it. Add a new optional field instead.`
          );
        }
        if (next.type !== old.type) {
          throw new DalError("INVALID", `The type of "${old.label}" can't change after registrations exist.`);
        }
      }
      for (const [key, next] of newByKey) {
        if (next.required && !oldByKey.get(key)?.required) {
          throw new DalError(
            "INVALID",
            `"${next.label}" can't be required after registrations exist. Make it optional so existing registrations stay valid.`
          );
        }
      }
      if (values.baseFeeCents !== before.baseFeeCents) {
        throw new DalError("INVALID", "The fee can't change after registrations exist, because each registration snapshots the fee.");
      }
    }

    const changed: string[] = [];
    const diff = (name: string, a: unknown, b: unknown) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(name);
    };
    diff("name", before.name, values.name);
    diff("description", before.description ?? null, values.description);
    diff("startsOn", before.startsOn ?? null, values.startsOn);
    diff("endsOn", before.endsOn ?? null, values.endsOn);
    diff("registrationOpensAt", before.registrationOpensAt?.getTime() ?? null, values.registrationOpensAt?.getTime() ?? null);
    diff("registrationClosesAt", before.registrationClosesAt?.getTime() ?? null, values.registrationClosesAt?.getTime() ?? null);
    diff("eligibleBirthDateFrom", before.eligibleBirthDateFrom ?? null, values.eligibleBirthDateFrom);
    diff("eligibleBirthDateTo", before.eligibleBirthDateTo ?? null, values.eligibleBirthDateTo);
    diff("baseFeeCents", before.baseFeeCents, values.baseFeeCents);
    diff("waiverVersionId", before.waiverVersionId ?? null, values.waiverVersionId);
    diff("customFormSchema", canonFields(before.customFormSchema), canonFields(values.customFormSchema));
    diff("isActive", before.isActive, values.isActive);
    if (changed.length === 0) return;

    await tx.update(seasons).set({ ...values, updatedAt: new Date() }).where(eq(seasons.id, seasonId));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "season.updated",
        targetType: "season",
        targetId: seasonId,
        metadata: {
          programId: before.programId,
          changed,
          liveRegistrations: n,
          ...(changed.includes("waiverVersionId")
            ? { waiverFrom: before.waiverVersionId, waiverTo: values.waiverVersionId }
            : {}),
        },
      },
      tx
    );
  });
}

/** Everything the season editor page needs (managers edit, other staff read). */
export async function getSeasonForEdit(
  ctx: SessionContext,
  slug: string,
  seasonId: string
): Promise<SeasonEditorData> {
  const program = await loadProgramBySlug(slug);
  if (!canViewRoster(ctx, program.id)) throw forbidden();
  if (!uuidRe.test(seasonId)) throw new DalError("NOT_FOUND", "Season not found.");
  const [s] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), eq(seasons.programId, program.id)))
    .limit(1);
  if (!s) throw new DalError("NOT_FOUND", "Season not found.");

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(registrations)
    .where(and(eq(registrations.seasonId, s.id), isNull(registrations.deletedAt)));
  const waivers = await listWaiverVersions(ctx, program.id);

  return {
    program: { id: program.id, slug: program.slug, name: program.name },
    canManage: canManageProgram(ctx, program.id),
    canOrgWideWaiver: isBoard(ctx),
    season: {
      id: s.id,
      name: s.name,
      description: s.description,
      startsOn: s.startsOn,
      endsOn: s.endsOn,
      registrationOpensAt: s.registrationOpensAt,
      registrationClosesAt: s.registrationClosesAt,
      eligibleBirthDateFrom: s.eligibleBirthDateFrom,
      eligibleBirthDateTo: s.eligibleBirthDateTo,
      baseFeeCents: s.baseFeeCents,
      waiverVersionId: s.waiverVersionId,
      customFormSchema: s.customFormSchema,
      isActive: s.isActive,
      status: computeSeasonStatus(s),
    },
    liveRegistrations: n,
    waiverVersions: waivers,
  };
}

/** Data for the "new season" page (managers only). */
export async function getNewSeasonContext(ctx: SessionContext, slug: string) {
  const program = await loadProgramBySlug(slug);
  if (!canManageProgram(ctx, program.id)) throw forbidden();
  return {
    program: { id: program.id, slug: program.slug, name: program.name },
    canOrgWideWaiver: isBoard(ctx),
    waiverVersions: await listWaiverVersions(ctx, program.id),
  };
}

/** Renders the season form + waiver exactly as families will see it. Staff only. */
export async function previewSeasonForm(ctx: SessionContext, seasonId: string): Promise<SeasonFormPreview> {
  if (!uuidRe.test(seasonId)) throw new DalError("NOT_FOUND", "Season not found.");
  const [s] = await db
    .select({
      id: seasons.id,
      programId: seasons.programId,
      name: seasons.name,
      baseFeeCents: seasons.baseFeeCents,
      customFormSchema: seasons.customFormSchema,
      waiverTitle: waiverVersions.title,
      waiverVersion: waiverVersions.version,
      waiverBody: waiverVersions.body,
    })
    .from(seasons)
    .leftJoin(waiverVersions, eq(waiverVersions.id, seasons.waiverVersionId))
    .where(eq(seasons.id, seasonId))
    .limit(1);
  if (!s) throw new DalError("NOT_FOUND", "Season not found.");
  if (!canViewRoster(ctx, s.programId)) throw forbidden();
  return {
    seasonId: s.id,
    name: s.name,
    feeCents: s.baseFeeCents,
    fields: s.customFormSchema,
    waiver:
      s.waiverTitle && s.waiverVersion && s.waiverBody !== null
        ? { title: s.waiverTitle, version: s.waiverVersion, body: s.waiverBody }
        : null,
  };
}

