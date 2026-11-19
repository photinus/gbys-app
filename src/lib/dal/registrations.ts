import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, notExists, or, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  athletes,
  householdGuardians,
  programs,
  registrations,
  seasons,
  signedWaivers,
  teamPlayers,
  users,
  waiverVersions,
} from "@/db/schema";
import type { CustomFormField } from "@/db/schema/programs";
import { writeAudit } from "@/lib/audit";
import { buildAnswersSchema } from "@/lib/custom-form";
import { utcToLaDateInput } from "@/lib/format";
import { registrationSubmitSchema } from "@/lib/validation/registration";
import { paymentRouteFor } from "@/lib/stripe";
import { hashWaiverBody } from "@/lib/waiver";
import { DalError, type SessionContext } from "./context";
import { canViewSeasonRoster } from "./permissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(id: string, what = "record"): void {
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", `That ${what} was not found.`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
/** Public, non-sensitive season summary (safe for signed-out visitors). */
export interface OpenSeason {
  seasonId: string;
  name: string;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  feeCents: number;
  closesAt: Date | null;
  eligibleBirthDateFrom: string | null;
  eligibleBirthDateTo: string | null;
  program: { slug: string; name: string; sport: string };
}

export interface RegistrationAthleteOption {
  id: string;
  name: string;
  dateOfBirth: string;
  eligible: boolean;
  /** Why the athlete cannot register for this season (null when eligible). */
  reason: string | null;
}

export interface RegistrationSeason extends OpenSeason {
  fields: CustomFormField[];
  waiver: { id: string; title: string; version: string; body: string };
  /** Present only when signed in. */
  athletes: RegistrationAthleteOption[] | null;
}

export interface RegistrationPage {
  program: { slug: string; name: string; sport: string; description: string | null };
  seasons: RegistrationSeason[];
}

export interface SubmitMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SubmitResult {
  registrationId: string;
  signedWaiverId: string;
  feeCents: number;
  paymentStatus: "unpaid" | "paid";
  /** True when a card payment can be started right now (route ready, fee > 0). */
  canPayOnline: boolean;
  athleteName: string;
  seasonName: string;
  programName: string;
}

export interface MyRegistration {
  id: string;
  programName: string;
  programSlug: string;
  seasonName: string;
  seasonStartsOn: string | null;
  athleteName: string;
  status: "active" | "cancelled";
  cancellationReason: string | null;
  cancelledAt: Date | null;
  feeCents: number;
  paymentStatus: "unpaid" | "pending" | "paid" | "waived_scholarship" | "refunded";
  /** Unpaid, live, fee > 0, guardian can register, and the program's card route is ready. */
  canPayOnline: boolean;
  /** Current Stripe Checkout session (lets the return page tell which registration it is about). */
  checkoutSessionId: string | null;
  createdAt: Date;
  waiver: { title: string; version: string; signatureName: string; signedAt: Date } | null;
  canWithdraw: boolean;
  /** Why it cannot be withdrawn (null when it can, or when cancelled). */
  withdrawBlockedReason: string | null;
}

export interface SignedWaiverView {
  registrationId: string;
  programName: string;
  seasonName: string;
  athleteName: string;
  title: string;
  version: string;
  body: string;
  storedHash: string;
  recomputedHash: string;
  hashMatches: boolean;
  signatureName: string;
  signedByName: string;
  signedAt: Date;
  /** Only for program staff / board. */
  ipAddress: string | null;
  userAgent: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** SQL predicate: the season accepts registrations right now. */
function seasonIsOpen(now: Date) {
  return and(
    eq(seasons.isActive, true),
    eq(programs.isActive, true),
    isNull(programs.deletedAt),
    sql`${seasons.waiverVersionId} is not null`,
    sql`${seasons.registrationOpensAt} is not null`,
    lte(seasons.registrationOpensAt, now),
    or(isNull(seasons.registrationClosesAt), gt(seasons.registrationClosesAt, now)),
  );
}

/** Inclusive DOB band check. Date-only strings compare correctly lexicographically. */
export function dobEligibility(
  dob: string,
  from: string | null,
  to: string | null,
): { eligible: boolean; reason: string | null } {
  if (from && dob < from) return { eligible: false, reason: "Born before this season's eligibility range." };
  if (to && dob > to) return { eligible: false, reason: "Born after this season's eligibility range." };
  return { eligible: true, reason: null };
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Number fields: an empty string means "no answer" (z.coerce would turn it into 0). */
function normalizeAnswers(fields: CustomFormField[], raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  for (const f of fields) {
    if (f.type === "number" && (src[f.key] === "" || src[f.key] === null)) delete src[f.key];
  }
  return src;
}

const openSeasonColumns = {
  seasonId: seasons.id,
  name: seasons.name,
  description: seasons.description,
  startsOn: seasons.startsOn,
  endsOn: seasons.endsOn,
  feeCents: seasons.baseFeeCents,
  closesAt: seasons.registrationClosesAt,
  eligibleBirthDateFrom: seasons.eligibleBirthDateFrom,
  eligibleBirthDateTo: seasons.eligibleBirthDateTo,
  programSlug: programs.slug,
  programName: programs.name,
  programSport: programs.sport,
};

function toOpenSeason(r: {
  seasonId: string;
  name: string;
  description: string | null;
  startsOn: string | null;
  endsOn: string | null;
  feeCents: number;
  closesAt: Date | null;
  eligibleBirthDateFrom: string | null;
  eligibleBirthDateTo: string | null;
  programSlug: string;
  programName: string;
  programSport: string;
}): OpenSeason {
  return {
    seasonId: r.seasonId,
    name: r.name,
    description: r.description,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    feeCents: r.feeCents,
    closesAt: r.closesAt,
    eligibleBirthDateFrom: r.eligibleBirthDateFrom,
    eligibleBirthDateTo: r.eligibleBirthDateTo,
    program: { slug: r.programSlug, name: r.programName, sport: r.programSport },
  };
}

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------
/**
 * Seasons accepting registrations right now. Public: ctx may be null. Never
 * returns household data; the ctx is accepted for symmetry and future use.
 */
export async function listOpenSeasons(_ctx: SessionContext | null): Promise<OpenSeason[]> {
  const now = new Date();
  const rows = await db
    .select(openSeasonColumns)
    .from(seasons)
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .where(seasonIsOpen(now))
    .orderBy(asc(programs.name), asc(seasons.registrationClosesAt), asc(seasons.name));
  return rows.map(toOpenSeason);
}

export interface OpenSeasonForFamily {
  season: OpenSeason;
  /** Eligible, not-yet-registered athletes (first names only). */
  athletes: { id: string; firstName: string }[];
}

/**
 * Open seasons the signed-in user could register an athlete for right now:
 * at least one athlete in their households (canRegister + canSignWaivers, the
 * same rights the register flow requires; not deleted) is
 * DOB-eligible and has no live registration for that season. Only the session
 * user's own households are consulted; no DOB or medical data is returned.
 * Two queries: the registerable athletes, then seasons x athletes filtered in SQL.
 */
export async function listOpenSeasonsForMyAthletes(
  ctx: SessionContext,
): Promise<{ items: OpenSeasonForFamily[]; hasRegisterableAthletes: boolean }> {
  const mine = await db
    .select({ id: athletes.id })
    .from(householdGuardians)
    .innerJoin(athletes, eq(athletes.id, householdGuardians.athleteId))
    .where(
      and(
        eq(householdGuardians.userId, ctx.userId),
        eq(householdGuardians.canRegister, true),
        eq(householdGuardians.canSignWaivers, true),
        isNull(athletes.deletedAt),
      ),
    );
  if (mine.length === 0) return { items: [], hasRegisterableAthletes: false };

  const now = new Date();
  const rows = await db
    .select({
      ...openSeasonColumns,
      athleteId: athletes.id,
      athleteFirstName: athletes.firstName,
    })
    .from(seasons)
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .innerJoin(
      householdGuardians,
      and(
        eq(householdGuardians.userId, ctx.userId),
        eq(householdGuardians.canRegister, true),
        eq(householdGuardians.canSignWaivers, true),
      ),
    )
    .innerJoin(athletes, and(eq(athletes.id, householdGuardians.athleteId), isNull(athletes.deletedAt)))
    .where(
      and(
        seasonIsOpen(now),
        or(isNull(seasons.eligibleBirthDateFrom), sql`${athletes.dateOfBirth} >= ${seasons.eligibleBirthDateFrom}`),
        or(isNull(seasons.eligibleBirthDateTo), sql`${athletes.dateOfBirth} <= ${seasons.eligibleBirthDateTo}`),
        notExists(
          db
            .select({ one: sql`1` })
            .from(registrations)
            .where(
              and(
                eq(registrations.seasonId, seasons.id),
                eq(registrations.athleteId, athletes.id),
                isNull(registrations.deletedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(
      asc(programs.name),
      asc(seasons.registrationClosesAt),
      asc(seasons.name),
      asc(athletes.firstName),
      asc(athletes.id),
    );

  const bySeason = new Map<string, OpenSeasonForFamily>();
  for (const r of rows) {
    let g = bySeason.get(r.seasonId);
    if (!g) {
      g = { season: toOpenSeason(r), athletes: [] };
      bySeason.set(r.seasonId, g);
    }
    g.athletes.push({ id: r.athleteId, firstName: r.athleteFirstName });
  }
  return { items: [...bySeason.values()], hasRegisterableAthletes: true };
}

/** Program + its open seasons (with form and waiver). Null if the program is unknown or inactive. */
export async function getRegistrationPage(
  ctx: SessionContext | null,
  slug: string,
): Promise<RegistrationPage | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const [program] = await db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      sport: programs.sport,
      description: programs.description,
    })
    .from(programs)
    .where(and(eq(programs.slug, slug), eq(programs.isActive, true), isNull(programs.deletedAt)))
    .limit(1);
  if (!program) return null;

  const now = new Date();
  const rows = await db
    .select({
      ...openSeasonColumns,
      fields: seasons.customFormSchema,
      waiverId: waiverVersions.id,
      waiverTitle: waiverVersions.title,
      waiverVersion: waiverVersions.version,
      waiverBody: waiverVersions.body,
    })
    .from(seasons)
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .innerJoin(waiverVersions, eq(waiverVersions.id, seasons.waiverVersionId))
    .where(and(eq(seasons.programId, program.id), seasonIsOpen(now)))
    .orderBy(asc(seasons.registrationClosesAt), asc(seasons.name));

  // Signed in: my household athletes (no medical data) and my live registrations.
  let myAthletes:
    | { id: string; name: string; dateOfBirth: string; canRegister: boolean; canSign: boolean }[]
    | null = null;
  const registered = new Set<string>(); // `${seasonId}:${athleteId}`
  if (ctx) {
    const a = await db
      .select({
        id: athletes.id,
        firstName: athletes.firstName,
        lastName: athletes.lastName,
        dateOfBirth: athletes.dateOfBirth,
        canRegister: householdGuardians.canRegister,
        canSign: householdGuardians.canSignWaivers,
      })
      .from(householdGuardians)
      .innerJoin(athletes, eq(athletes.id, householdGuardians.athleteId))
      .where(and(eq(householdGuardians.userId, ctx.userId), isNull(athletes.deletedAt)))
      .orderBy(asc(athletes.firstName), asc(athletes.lastName));
    myAthletes = a.map((x) => ({
      id: x.id,
      name: `${x.firstName} ${x.lastName}`,
      dateOfBirth: x.dateOfBirth,
      canRegister: x.canRegister,
      canSign: x.canSign,
    }));
    if (rows.length > 0 && myAthletes.length > 0) {
      const regs = await db
        .select({ seasonId: registrations.seasonId, athleteId: registrations.athleteId })
        .from(registrations)
        .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
        .where(and(eq(seasons.programId, program.id), isNull(registrations.deletedAt)));
      const mine = new Set(myAthletes.map((x) => x.id));
      for (const r of regs) if (mine.has(r.athleteId)) registered.add(`${r.seasonId}:${r.athleteId}`);
    }
  }

  return {
    program: {
      slug: program.slug,
      name: program.name,
      sport: program.sport,
      description: program.description,
    },
    seasons: rows.map((r) => ({
      ...toOpenSeason(r),
      fields: r.fields,
      waiver: { id: r.waiverId, title: r.waiverTitle, version: r.waiverVersion, body: r.waiverBody },
      athletes: myAthletes
        ? myAthletes.map((a) => {
            let elig = dobEligibility(a.dateOfBirth, r.eligibleBirthDateFrom, r.eligibleBirthDateTo);
            if (elig.eligible && registered.has(`${r.seasonId}:${a.id}`))
              elig = { eligible: false, reason: "Already registered for this season." };
            if (elig.eligible && !a.canRegister)
              elig = { eligible: false, reason: "You are not allowed to register this athlete." };
            if (elig.eligible && !a.canSign)
              elig = { eligible: false, reason: "You are not allowed to sign waivers for this athlete." };
            return {
              id: a.id,
              name: a.name,
              dateOfBirth: a.dateOfBirth,
              eligible: elig.eligible,
              reason: elig.reason,
            };
          })
        : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Registration + waiver e-signature (invariant 5)
// ---------------------------------------------------------------------------
export async function submitRegistration(
  ctx: SessionContext,
  input: unknown,
  meta: SubmitMeta,
): Promise<SubmitResult> {
  const data = registrationSubmitSchema.parse(input);
  const ipAddress = meta.ipAddress ? meta.ipAddress.slice(0, 64) : null;
  const userAgent = meta.userAgent ? meta.userAgent.slice(0, 512) : null;

  try {
    return await db.transaction(async (tx) => {
      // 1. Serialize all submissions for this season.
      const [season] = await tx
        .select()
        .from(seasons)
        .where(eq(seasons.id, data.seasonId))
        .for("update")
        .limit(1);
      if (!season) throw new DalError("NOT_FOUND", "That season was not found.");

      const [program] = await tx
        .select({
          id: programs.id,
          name: programs.name,
          isActive: programs.isActive,
          deletedAt: programs.deletedAt,
          isIndependentPartner: programs.isIndependentPartner,
          stripeAccountId: programs.stripeAccountId,
          stripeOnboardingComplete: programs.stripeOnboardingComplete,
        })
        .from(programs)
        .where(eq(programs.id, season.programId))
        .limit(1);

      // 2. Still open? Waiver still current?
      const now = new Date();
      const open =
        season.isActive &&
        !!program?.isActive &&
        !program.deletedAt &&
        !!season.waiverVersionId &&
        !!season.registrationOpensAt &&
        season.registrationOpensAt <= now &&
        (!season.registrationClosesAt || season.registrationClosesAt > now);
      if (!open) throw new DalError("INVALID", "Registration for this season is not open.");
      if (season.waiverVersionId !== data.waiverVersionId)
        throw new DalError("INVALID", "The waiver was updated — please review it");

      const [version] = await tx
        .select()
        .from(waiverVersions)
        .where(eq(waiverVersions.id, season.waiverVersionId!))
        .limit(1);
      if (!version) throw new DalError("INVALID", "Registration for this season is not open.");

      // 3. Guardian permissions.
      const [athlete] = await tx
        .select({
          id: athletes.id,
          firstName: athletes.firstName,
          lastName: athletes.lastName,
          dateOfBirth: athletes.dateOfBirth,
        })
        .from(athletes)
        .where(and(eq(athletes.id, data.athleteId), isNull(athletes.deletedAt)))
        .limit(1);
      const [link] = athlete
        ? await tx
            .select()
            .from(householdGuardians)
            .where(
              and(eq(householdGuardians.athleteId, data.athleteId), eq(householdGuardians.userId, ctx.userId)),
            )
            .limit(1)
        : [];
      if (!athlete || !link) throw new DalError("FORBIDDEN", "You are not a guardian of that athlete.");
      if (!link.canRegister)
        throw new DalError("FORBIDDEN", "You are not allowed to register this athlete.");
      if (!link.canSignWaivers)
        throw new DalError("FORBIDDEN", "You are not allowed to sign waivers for this athlete.");

      // 4. DOB eligibility.
      const elig = dobEligibility(athlete.dateOfBirth, season.eligibleBirthDateFrom, season.eligibleBirthDateTo);
      if (!elig.eligible)
        throw new DalError("INVALID", `${athlete.firstName} is not eligible for this season. ${elig.reason}`);

      // Duplicate (the season lock makes this check reliable; the unique index backs it up).
      const [dup] = await tx
        .select({ id: registrations.id })
        .from(registrations)
        .where(
          and(
            eq(registrations.seasonId, season.id),
            eq(registrations.athleteId, athlete.id),
            isNull(registrations.deletedAt),
          ),
        )
        .limit(1);
      if (dup) throw new DalError("INVALID", `${athlete.firstName} is already registered for this season.`);

      // 5. Answers.
      const parsed = buildAnswersSchema(season.customFormSchema).safeParse(
        normalizeAnswers(season.customFormSchema, data.answers),
      );
      if (!parsed.success) throw new DalError("INVALID", parsed.error.issues[0]?.message ?? "Check your answers.");

      // 8 (checked before any insert). The stored text must still hash to the stored hash.
      const recomputed = hashWaiverBody(version.body);
      if (recomputed !== version.bodyHash) {
        console.error("[waiver] body hash mismatch", { waiverVersionId: version.id });
        throw new DalError("INVALID", "This waiver failed an integrity check. Please contact GBYS.");
      }

      // 7. Registration.
      const free = season.baseFeeCents === 0;
      const [reg] = await tx
        .insert(registrations)
        .values({
          seasonId: season.id,
          athleteId: athlete.id,
          registeredByUserId: ctx.userId,
          customAnswers: parsed.data as Record<string, unknown>,
          feeCents: season.baseFeeCents,
          paymentStatus: free ? "paid" : "unpaid",
          amountPaidCents: free ? 0 : null,
        })
        .returning({ id: registrations.id });

      // 8. Immutable signature record.
      const [sig] = await tx
        .insert(signedWaivers)
        .values({
          registrationId: reg.id,
          athleteId: athlete.id,
          signedByUserId: ctx.userId,
          waiverVersionId: version.id,
          waiverVersion: version.version,
          waiverTextHash: version.bodyHash,
          signatureName: data.signatureName,
          ipAddress,
          userAgent,
        })
        .returning({ id: signedWaivers.id });

      // 9. Audit.
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "registration.created",
          targetType: "registration",
          targetId: reg.id,
          metadata: { seasonId: season.id, athleteId: athlete.id, feeCents: season.baseFeeCents },
        },
        tx,
      );
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "waiver.signed",
          targetType: "signed_waiver",
          targetId: sig.id,
          metadata: {
            registrationId: reg.id,
            athleteId: athlete.id,
            waiverVersionId: version.id,
            waiverVersion: version.version,
            waiverTextHash: version.bodyHash,
          },
        },
        tx,
      );

      return {
        registrationId: reg.id,
        signedWaiverId: sig.id,
        feeCents: season.baseFeeCents,
        paymentStatus: free ? ("paid" as const) : ("unpaid" as const),
        canPayOnline: !free && paymentRouteFor(program!).ready,
        athleteName: `${athlete.firstName} ${athlete.lastName}`,
        seasonName: season.name,
        programName: program!.name,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DalError("INVALID", "That athlete is already registered for this season.");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// My registrations
// ---------------------------------------------------------------------------
export async function listMyRegistrations(ctx: SessionContext): Promise<MyRegistration[]> {
  const rows = await db
    .select({
      id: registrations.id,
      programName: programs.name,
      programSlug: programs.slug,
      seasonName: seasons.name,
      seasonStartsOn: seasons.startsOn,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      deletedAt: registrations.deletedAt,
      cancellationReason: registrations.cancellationReason,
      feeCents: registrations.feeCents,
      paymentStatus: registrations.paymentStatus,
      paymentMethod: registrations.paymentMethod,
      checkoutSessionId: registrations.stripeCheckoutSessionId,
      isIndependentPartner: programs.isIndependentPartner,
      stripeAccountId: programs.stripeAccountId,
      stripeOnboardingComplete: programs.stripeOnboardingComplete,
      createdAt: registrations.createdAt,
      canRegister: householdGuardians.canRegister,
      wTitle: waiverVersions.title,
      wVersion: signedWaivers.waiverVersion,
      wName: signedWaivers.signatureName,
      wSignedAt: signedWaivers.signedAt,
    })
    .from(registrations)
    .innerJoin(householdGuardians, and(eq(householdGuardians.athleteId, registrations.athleteId), eq(householdGuardians.userId, ctx.userId)))
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .leftJoin(signedWaivers, eq(signedWaivers.registrationId, registrations.id))
    .leftJoin(waiverVersions, eq(waiverVersions.id, signedWaivers.waiverVersionId))
    .orderBy(desc(registrations.createdAt));

  const today = utcToLaDateInput(new Date());
  return rows.map((r) => {
    const cancelled = !!r.deletedAt;
    const block = cancelled ? null : withdrawBlock(r, today);
    return {
      id: r.id,
      programName: r.programName,
      programSlug: r.programSlug,
      seasonName: r.seasonName,
      seasonStartsOn: r.seasonStartsOn,
      athleteName: `${r.firstName} ${r.lastName}`,
      status: cancelled ? "cancelled" : "active",
      cancellationReason: cancelled ? r.cancellationReason : null,
      cancelledAt: r.deletedAt,
      feeCents: r.feeCents,
      paymentStatus: r.paymentStatus,
      canPayOnline:
        !cancelled && r.canRegister && r.paymentStatus === "unpaid" && r.feeCents > 0 && paymentRouteFor(r).ready,
      checkoutSessionId: cancelled ? null : r.checkoutSessionId,
      createdAt: r.createdAt,
      waiver: r.wName && r.wSignedAt && r.wVersion
        ? { title: r.wTitle ?? "Waiver", version: r.wVersion, signatureName: r.wName, signedAt: r.wSignedAt }
        : null,
      canWithdraw: !cancelled && block === null,
      withdrawBlockedReason: block,
    };
  });
}

/** Shared by the list and by withdrawRegistration. Null = may withdraw. */
function withdrawBlock(
  r: {
    canRegister: boolean;
    paymentStatus: string;
    paymentMethod: string | null;
    feeCents: number;
    seasonStartsOn: string | null;
  },
  today: string,
): string | null {
  if (!r.canRegister) return "Only a guardian who can register this athlete can withdraw.";
  // Nothing may have been paid. A free registration is stored as "paid" with no payment method.
  const nothingPaid = r.paymentStatus === "unpaid" || (r.feeCents === 0 && r.paymentMethod === null && r.paymentStatus === "paid");
  if (!nothingPaid) return "A payment is on file. Contact the program to cancel.";
  if (r.seasonStartsOn && today >= r.seasonStartsOn) return "The season has started. Contact the program to cancel.";
  return null;
}

export async function withdrawRegistration(ctx: SessionContext, registrationId: string): Promise<void> {
  assertUuid(registrationId, "registration");
  await db.transaction(async (tx) => {
    const [reg] = await tx
      .select({
        id: registrations.id,
        athleteId: registrations.athleteId,
        seasonId: registrations.seasonId,
        deletedAt: registrations.deletedAt,
        paymentStatus: registrations.paymentStatus,
        paymentMethod: registrations.paymentMethod,
        feeCents: registrations.feeCents,
        seasonStartsOn: seasons.startsOn,
      })
      .from(registrations)
      .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
      .where(eq(registrations.id, registrationId))
      .for("update", { of: registrations })
      .limit(1);
    const [link] = reg
      ? await tx
          .select()
          .from(householdGuardians)
          .where(and(eq(householdGuardians.athleteId, reg.athleteId), eq(householdGuardians.userId, ctx.userId)))
          .limit(1)
      : [];
    if (!reg || !link) throw new DalError("NOT_FOUND", "That registration was not found.");
    if (reg.deletedAt) throw new DalError("INVALID", "That registration is already cancelled.");
    const block = withdrawBlock({ ...reg, canRegister: link.canRegister }, utcToLaDateInput(new Date()));
    if (block) throw new DalError(link.canRegister ? "INVALID" : "FORBIDDEN", block);

    await tx
      .update(registrations)
      .set({
        deletedAt: new Date(),
        deletedByUserId: ctx.userId,
        cancellationReason: "Withdrawn by guardian",
      })
      .where(eq(registrations.id, reg.id));
    // A withdrawn registration leaves its team (history kept via removedAt).
    await tx
      .update(teamPlayers)
      .set({ removedAt: new Date(), removedByUserId: ctx.userId })
      .where(and(eq(teamPlayers.registrationId, reg.id), isNull(teamPlayers.removedAt)));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "registration.withdrawn",
        targetType: "registration",
        targetId: reg.id,
        metadata: { seasonId: reg.seasonId, athleteId: reg.athleteId },
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Signed waiver record
// ---------------------------------------------------------------------------
/** Guardian of the athlete, or program staff / board: the exact text that was signed. */
export async function getSignedWaiver(ctx: SessionContext, registrationId: string): Promise<SignedWaiverView> {
  assertUuid(registrationId, "registration");
  const [row] = await db
    .select({
      registrationId: registrations.id,
      athleteId: registrations.athleteId,
      programId: programs.id,
      programName: programs.name,
      seasonName: seasons.name,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      title: waiverVersions.title,
      version: signedWaivers.waiverVersion,
      body: waiverVersions.body,
      storedHash: signedWaivers.waiverTextHash,
      signatureName: signedWaivers.signatureName,
      signedByName: users.name,
      signedAt: signedWaivers.signedAt,
      ipAddress: signedWaivers.ipAddress,
      userAgent: signedWaivers.userAgent,
    })
    .from(signedWaivers)
    .innerJoin(registrations, eq(registrations.id, signedWaivers.registrationId))
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .innerJoin(waiverVersions, eq(waiverVersions.id, signedWaivers.waiverVersionId))
    .innerJoin(users, eq(users.id, signedWaivers.signedByUserId))
    .where(eq(signedWaivers.registrationId, registrationId))
    .orderBy(asc(signedWaivers.signedAt))
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "That signed waiver was not found.");

  // Season-roster viewers (program admin / board) see the full record including IP and user agent.
  const staff = canViewSeasonRoster(ctx, row.programId);
  if (!staff) {
    const [link] = await db
      .select({ id: householdGuardians.id })
      .from(householdGuardians)
      .where(and(eq(householdGuardians.athleteId, row.athleteId), eq(householdGuardians.userId, ctx.userId)))
      .limit(1);
    if (!link) {
      // Staff of a team this registration is live on may read the signed text (no IP / user agent).
      const teamIds = [...new Set(ctx.teamStaff.map((t) => t.teamId))];
      const [onTeam] = teamIds.length
        ? await db
            .select({ id: teamPlayers.id })
            .from(teamPlayers)
            .where(and(eq(teamPlayers.registrationId, registrationId), isNull(teamPlayers.removedAt), inArray(teamPlayers.teamId, teamIds)))
            .limit(1)
        : [];
      if (!onTeam) throw new DalError("NOT_FOUND", "That signed waiver was not found.");
    }
  }

  const recomputed = hashWaiverBody(row.body);
  return {
    registrationId: row.registrationId,
    programName: row.programName,
    seasonName: row.seasonName,
    athleteName: `${row.firstName} ${row.lastName}`,
    title: row.title,
    version: row.version,
    body: row.body,
    storedHash: row.storedHash,
    recomputedHash: recomputed,
    hashMatches: recomputed === row.storedHash,
    signatureName: row.signatureName,
    signedByName: row.signedByName,
    signedAt: row.signedAt,
    ipAddress: staff ? row.ipAddress : null,
    userAgent: staff ? row.userAgent : null,
  };
}
