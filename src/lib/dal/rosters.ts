import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  athletes,
  householdGuardians,
  paymentEvents,
  programRoles,
  programs,
  registrations,
  seasons,
  signedWaivers,
  teamPlayers,
  teamStaff,
  teams,
  users,
} from "@/db/schema";
import type { EmergencyContact } from "@/db/schema/household";
import { ageFromDob } from "@/components/household/age";
import { athletePhotoUrl } from "./photos";
import { writeAudit } from "@/lib/audit";
import { formatCents } from "@/lib/format";
import {
  recordPaymentSchema,
  reasonSchema,
  type RecordPaymentInput,
  type RosterFilter,
} from "@/lib/validation/rosters";
import { DalError, isBoard, type SessionContext } from "./context";
import { PROGRAM_STAFF_ROLES, assertProgramReachable, canManageProgram, canViewSeasonRoster, canViewTeam } from "./permissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUND_WARNING_OFFLINE = "This registration was paid offline. Return the money outside the app.";
const REFUND_WARNING_STRIPE = "This registration was paid by card. Use Refund on the roster to return the money.";

function parseId(id: string, what: string): string {
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", `${what} not found.`);
  return id;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SeasonHeader {
  seasonId: string;
  seasonName: string;
  programId: string;
  programName: string;
  programSlug: string;
  programActive: boolean;
  feeCents: number;
  canManage: boolean;
  isBoard: boolean;
}

/** Roster row. Deliberately has NO medical notes and NO emergency contacts. */
export interface RosterRow {
  registrationId: string;
  athleteName: string;
  /** Versioned /media/athlete URL; null when no photo or the registration is cancelled. */
  photoUrl: string | null;
  age: number | null;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string | null;
  answers: { label: string; value: string }[];
  feeCents: number;
  paymentStatus: "unpaid" | "pending" | "paid" | "waived_scholarship" | "refunded";
  paymentMethod: "stripe" | "cash" | "check" | "scholarship" | null;
  amountPaidCents: number | null;
  paidAt: Date | null;
  /** Total refunded so far (cents), mirrored from Stripe by the webhook. */
  refundedCents: number;
  /** Set while/after a card dispute is open. */
  disputedAt: Date | null;
  reference: string | null;
  waiver: { version: string; signedAt: Date } | null;
  registeredAt: Date;
  cancelledAt: Date | null;
  cancellationReason: string | null;
}

export interface RosterKpis {
  registered: number;
  paid: number;
  unpaid: number;
  collectedCents: number;
}

export interface SeasonRoster {
  header: SeasonHeader;
  filter: RosterFilter;
  rows: RosterRow[];
  kpis: RosterKpis;
}

export interface EmergencyAthlete {
  registrationId: string;
  athleteId: string;
  photoUrl: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  age: number | null;
  medicalNotes: string | null;
  emergencyContacts: EmergencyContact[];
  guardians: { name: string; phone: string | null; relationship: string }[];
}

export interface EmergencySheet {
  header: SeasonHeader;
  /** Set for a team emergency sheet (players limited to the team; staff are the team's staff). */
  team?: { id: string; name: string; division: string | null };
  generatedAt: Date;
  athletes: EmergencyAthlete[];
  staff: { name: string; phone: string | null; role: string }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function loadSeasonHeader(ctx: SessionContext, seasonId: string): Promise<SeasonHeader & { customFormSchema: { key: string; label: string }[] }> {
  const id = parseId(seasonId, "Season");
  const [s] = await db
    .select({
      seasonId: seasons.id,
      seasonName: seasons.name,
      programId: programs.id,
      programName: programs.name,
      programSlug: programs.slug,
      programActive: programs.isActive,
      feeCents: seasons.baseFeeCents,
      form: seasons.customFormSchema,
    })
    .from(seasons)
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .where(and(eq(seasons.id, id), isNull(programs.deletedAt)))
    .limit(1);
  // Whole-season roster / emergency data: program admins and the board only (coaches use their team's sheet).
  // Hide existence from everyone else.
  if (!s || !canViewSeasonRoster(ctx, s.programId)) throw new DalError("NOT_FOUND", "Season not found.");
  // Inactive programs are board-only.
  if (!s.programActive && !isBoard(ctx)) throw new DalError("NOT_FOUND", "Season not found.");
  const { form, ...rest } = s;
  return {
    ...rest,
    canManage: canManageProgram(ctx, s.programId),
    isBoard: isBoard(ctx),
    customFormSchema: form ?? [],
  };
}

function renderAnswer(v: unknown): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v === null || v === undefined || v === "") return "";
  return String(v);
}

// ---------------------------------------------------------------------------
// Roster (no medical data)
// ---------------------------------------------------------------------------
export async function listSeasonRegistrations(
  ctx: SessionContext,
  seasonId: string,
  filter: RosterFilter = "all"
): Promise<SeasonRoster> {
  const header = await loadSeasonHeader(ctx, seasonId);

  const regs = await db
    .select({
      registrationId: registrations.id,
      athleteId: athletes.id,
      photoObjectKey: athletes.photoObjectKey,
      photoUpdatedAt: athletes.photoUpdatedAt,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      dateOfBirth: athletes.dateOfBirth,
      guardianName: users.name,
      guardianEmail: users.email,
      guardianPhone: users.phone,
      customAnswers: registrations.customAnswers,
      feeCents: registrations.feeCents,
      paymentStatus: registrations.paymentStatus,
      paymentMethod: registrations.paymentMethod,
      amountPaidCents: registrations.amountPaidCents,
      paidAt: registrations.paidAt,
      refundedCents: registrations.refundedCents,
      disputedAt: registrations.disputedAt,
      reference: registrations.offlineReferenceNote,
      registeredAt: registrations.createdAt,
      cancelledAt: registrations.deletedAt,
      cancellationReason: registrations.cancellationReason,
    })
    .from(registrations)
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .innerJoin(users, eq(users.id, registrations.registeredByUserId))
    .where(eq(registrations.seasonId, header.seasonId))
    .orderBy(asc(athletes.lastName), asc(athletes.firstName));

  const ids = regs.map((r) => r.registrationId);
  const waivers = ids.length
    ? await db
        .select({
          registrationId: signedWaivers.registrationId,
          version: signedWaivers.waiverVersion,
          signedAt: signedWaivers.signedAt,
        })
        .from(signedWaivers)
        .where(inArray(signedWaivers.registrationId, ids))
        .orderBy(asc(signedWaivers.signedAt))
    : [];
  const waiverByReg = new Map<string, { version: string; signedAt: Date }>();
  for (const w of waivers) if (w.registrationId) waiverByReg.set(w.registrationId, { version: w.version, signedAt: w.signedAt });

  const labelFor = new Map(header.customFormSchema.map((f) => [f.key, f.label]));
  const all: RosterRow[] = regs.map((r) => ({
    registrationId: r.registrationId,
    athleteName: `${r.firstName} ${r.lastName}`.trim(),
    photoUrl: r.cancelledAt ? null : athletePhotoUrl({ id: r.athleteId, photoObjectKey: r.photoObjectKey, photoUpdatedAt: r.photoUpdatedAt }),
    age: ageFromDob(r.dateOfBirth),
    guardianName: r.guardianName,
    guardianEmail: r.guardianEmail,
    guardianPhone: r.guardianPhone,
    answers: Object.entries(r.customAnswers ?? {})
      .map(([k, v]) => ({ label: labelFor.get(k) ?? k, value: renderAnswer(v) }))
      .filter((a) => a.value !== ""),
    feeCents: r.feeCents,
    paymentStatus: r.paymentStatus,
    paymentMethod: r.paymentMethod,
    amountPaidCents: r.amountPaidCents,
    paidAt: r.paidAt,
    refundedCents: r.refundedCents,
    disputedAt: r.disputedAt,
    reference: r.reference,
    waiver: waiverByReg.get(r.registrationId) ?? null,
    registeredAt: r.registeredAt,
    cancelledAt: r.cancelledAt,
    cancellationReason: r.cancellationReason,
  }));

  const live = all.filter((r) => !r.cancelledAt);
  const isPaid = (r: RosterRow) => r.paymentStatus === "paid" || r.paymentStatus === "waived_scholarship";
  const kpis: RosterKpis = {
    registered: live.length,
    paid: live.filter(isPaid).length,
    unpaid: live.filter((r) => !isPaid(r)).length,
    collectedCents: live
      .filter((r) => r.paymentStatus === "paid")
      .reduce((n, r) => n + Math.max(0, (r.amountPaidCents ?? 0) - r.refundedCents), 0),
  };

  let rows: RosterRow[];
  switch (filter) {
    case "unpaid":
      rows = live.filter((r) => !isPaid(r));
      break;
    case "paid":
      rows = live.filter(isPaid);
      break;
    case "cancelled":
      rows = all.filter((r) => r.cancelledAt);
      break;
    default:
      rows = live;
  }

  await writeAudit({
    actorUserId: ctx.userId,
    action: "roster.viewed",
    targetType: "season",
    targetId: header.seasonId,
    metadata: { filter, rowCount: rows.length },
  });

  const { customFormSchema: _omit, ...pub } = header;
  void _omit;
  return { header: pub, filter, rows, kpis };
}

// ---------------------------------------------------------------------------
// Offline payments
// ---------------------------------------------------------------------------
async function lockRegistration(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], registrationId: string) {
  const id = parseId(registrationId, "Registration");
  const [row] = await tx
    .select({
      id: registrations.id,
      seasonId: registrations.seasonId,
      programId: seasons.programId,
      feeCents: registrations.feeCents,
      paymentStatus: registrations.paymentStatus,
      paymentMethod: registrations.paymentMethod,
      amountPaidCents: registrations.amountPaidCents,
      paidAt: registrations.paidAt,
      paymentRecordedByUserId: registrations.paymentRecordedByUserId,
      stripePaymentIntentId: registrations.stripePaymentIntentId,
      reference: registrations.offlineReferenceNote,
      deletedAt: registrations.deletedAt,
    })
    .from(registrations)
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .where(eq(registrations.id, id))
    .for("update", { of: registrations })
    .limit(1);
  return row;
}

export async function recordOfflinePayment(
  ctx: SessionContext,
  registrationId: string,
  input: RecordPaymentInput
): Promise<void> {
  const data = recordPaymentSchema.parse(input);
  await db.transaction(async (tx) => {
    const row = await lockRegistration(tx, registrationId);
    if (!row) throw new DalError("NOT_FOUND", "Registration not found.");
    if (!canManageProgram(ctx, row.programId)) {
      throw new DalError("FORBIDDEN", "You do not have permission to record payments.");
    }
    await assertProgramReachable(ctx, row.programId, tx);
    if (row.deletedAt) throw new DalError("INVALID", "This registration was cancelled.");
    if (row.paymentStatus !== "unpaid") {
      throw new DalError("INVALID", "This registration is not awaiting payment.");
    }

    let status: "paid" | "waived_scholarship";
    let amount: number;
    if (data.method === "scholarship") {
      status = "waived_scholarship";
      amount = 0;
    } else {
      status = "paid";
      amount = data.amountCents;
      if (amount < row.feeCents) {
        throw new DalError(
          "INVALID",
          `Partial payments are not supported. The amount must equal the fee (${formatCents(row.feeCents)}), or record a scholarship.`
        );
      }
      if (amount > row.feeCents) {
        throw new DalError("INVALID", `The amount cannot exceed the fee (${formatCents(row.feeCents)}).`);
      }
    }

    const now = new Date();
    await tx
      .update(registrations)
      .set({
        paymentStatus: status,
        paymentMethod: data.method,
        amountPaidCents: amount,
        paidAt: now,
        paymentRecordedByUserId: ctx.userId,
        offlineReferenceNote: data.reference || null,
      })
      .where(eq(registrations.id, row.id));
    await tx.insert(paymentEvents).values({
      registrationId: row.id,
      programId: row.programId,
      kind: "offline_payment",
      amountCents: amount,
      method: data.method,
      note: data.reference || null,
      recordedByUserId: ctx.userId,
      occurredAt: now,
    });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "payment.recorded",
        targetType: "registration",
        targetId: row.id,
        metadata: {
          seasonId: row.seasonId,
          method: data.method,
          amountCents: amount,
          feeCents: row.feeCents,
          reference: data.reference || null,
        },
      },
      tx
    );
  });
}

export async function voidOfflinePayment(
  ctx: SessionContext,
  registrationId: string,
  reason: string
): Promise<void> {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "Only the board can void a payment.");
  const why = reasonSchema.parse(reason);
  await db.transaction(async (tx) => {
    const row = await lockRegistration(tx, registrationId);
    if (!row) throw new DalError("NOT_FOUND", "Registration not found.");
    if (row.deletedAt) throw new DalError("INVALID", "This registration was cancelled.");
    if (row.paymentMethod === "stripe" || row.stripePaymentIntentId) {
      throw new DalError("INVALID", "Card payments cannot be voided. Use Refund on the roster instead.");
    }
    if (
      (row.paymentStatus !== "paid" && row.paymentStatus !== "waived_scholarship") ||
      !row.paymentMethod
    ) {
      throw new DalError("INVALID", "There is no recorded payment to void.");
    }
    await tx
      .update(registrations)
      .set({
        paymentStatus: "unpaid",
        paymentMethod: null,
        amountPaidCents: null,
        paidAt: null,
        paymentRecordedByUserId: null,
        offlineReferenceNote: null,
      })
      .where(eq(registrations.id, row.id));
    await tx.insert(paymentEvents).values({
      registrationId: row.id,
      programId: row.programId,
      kind: "offline_void",
      amountCents: row.amountPaidCents ?? 0,
      method: row.paymentMethod,
      note: why,
      recordedByUserId: ctx.userId,
    });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "payment.voided",
        targetType: "registration",
        targetId: row.id,
        metadata: {
          seasonId: row.seasonId,
          reason: why,
          previous: {
            paymentStatus: row.paymentStatus,
            paymentMethod: row.paymentMethod,
            amountPaidCents: row.amountPaidCents,
            paidAt: row.paidAt?.toISOString() ?? null,
            recordedByUserId: row.paymentRecordedByUserId,
            reference: row.reference,
          },
        },
      },
      tx
    );
  });
}

/** Returns a warning string when the cancelled registration had been paid. */
export async function cancelRegistration(
  ctx: SessionContext,
  registrationId: string,
  reason: string
): Promise<{ warning: string | null }> {
  const why = reasonSchema.parse(reason);
  return db.transaction(async (tx) => {
    const row = await lockRegistration(tx, registrationId);
    if (!row) throw new DalError("NOT_FOUND", "Registration not found.");
    if (!canManageProgram(ctx, row.programId)) {
      throw new DalError("FORBIDDEN", "You do not have permission to cancel registrations.");
    }
    await assertProgramReachable(ctx, row.programId, tx);
    if (row.deletedAt) throw new DalError("INVALID", "This registration is already cancelled.");
    const wasPaid = row.paymentStatus !== "unpaid";
    await tx
      .update(registrations)
      .set({ deletedAt: new Date(), deletedByUserId: ctx.userId, cancellationReason: why })
      .where(eq(registrations.id, row.id));
    // A cancelled registration leaves its team (history kept via removedAt).
    await tx
      .update(teamPlayers)
      .set({ removedAt: new Date(), removedByUserId: ctx.userId })
      .where(and(eq(teamPlayers.registrationId, row.id), isNull(teamPlayers.removedAt)));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "registration.cancelled",
        targetType: "registration",
        targetId: row.id,
        metadata: {
          seasonId: row.seasonId,
          reason: why,
          wasPaid,
          paymentStatus: row.paymentStatus,
          paymentMethod: row.paymentMethod,
          amountPaidCents: row.amountPaidCents,
        },
      },
      tx
    );
    return { warning: wasPaid && row.paymentStatus !== "refunded" ? (row.paymentMethod === "stripe" ? REFUND_WARNING_STRIPE : REFUND_WARNING_OFFLINE) : null };
  });
}

// ---------------------------------------------------------------------------
// Emergency sheet (medical data; audited)
// ---------------------------------------------------------------------------

type EmergencyDbRow = {
  registrationId: string;
  athleteId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  photoObjectKey: string | null;
  photoUpdatedAt: Date | null;
  medicalNotes: string | null;
  emergencyContacts: EmergencyContact[] | null;
};

async function loadGuardiansByAthlete(athleteIds: string[]): Promise<Map<string, EmergencyAthlete["guardians"]>> {
  const guardianRows = athleteIds.length
    ? await db
        .select({
          athleteId: householdGuardians.athleteId,
          name: users.name,
          phone: users.phone,
          relationship: householdGuardians.relationship,
          receivesComms: householdGuardians.receivesComms,
        })
        .from(householdGuardians)
        .innerJoin(users, eq(users.id, householdGuardians.userId))
        .where(and(inArray(householdGuardians.athleteId, athleteIds), isNull(users.deletedAt)))
        .orderBy(sql`${householdGuardians.receivesComms} desc`, asc(householdGuardians.createdAt))
    : [];
  const byAthlete = new Map<string, EmergencyAthlete["guardians"]>();
  for (const g of guardianRows) {
    const list = byAthlete.get(g.athleteId) ?? [];
    list.push({ name: g.name, phone: g.phone, relationship: g.relationship });
    byAthlete.set(g.athleteId, list);
  }
  return byAthlete;
}

function toEmergencyAthletes(rows: EmergencyDbRow[], byAthlete: Map<string, EmergencyAthlete["guardians"]>): EmergencyAthlete[] {
  return rows.map(({ photoObjectKey, photoUpdatedAt, ...r }) => ({
    ...r,
    photoUrl: athletePhotoUrl({ id: r.athleteId, photoObjectKey, photoUpdatedAt }),
    age: ageFromDob(r.dateOfBirth),
    emergencyContacts: r.emergencyContacts ?? [],
    guardians: byAthlete.get(r.athleteId) ?? [],
  }));
}

export async function getEmergencySheet(
  ctx: SessionContext,
  seasonId: string,
  expectedProgramSlug?: string
): Promise<EmergencySheet> {
  const header = await loadSeasonHeader(ctx, seasonId);
  // Reject a mismatched URL before any medical data is read or audited.
  if (expectedProgramSlug !== undefined && header.programSlug !== expectedProgramSlug) {
    throw new DalError("NOT_FOUND", "Season not found.");
  }

  const rows = await db
    .select({
      registrationId: registrations.id,
      athleteId: athletes.id,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      dateOfBirth: athletes.dateOfBirth,
      photoObjectKey: athletes.photoObjectKey,
      photoUpdatedAt: athletes.photoUpdatedAt,
      medicalNotes: athletes.medicalNotes,
      emergencyContacts: athletes.emergencyContacts,
    })
    .from(registrations)
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .where(
      and(
        eq(registrations.seasonId, header.seasonId),
        isNull(registrations.deletedAt),
        isNull(athletes.deletedAt)
      )
    )
    .orderBy(asc(athletes.lastName), asc(athletes.firstName));

  const byAthlete = await loadGuardiansByAthlete(rows.map((r) => r.athleteId));

  const staffRows = await db
    .select({ name: users.name, phone: users.phone, role: programRoles.role })
    .from(programRoles)
    .innerJoin(users, eq(users.id, programRoles.userId))
    .where(
      and(
        eq(programRoles.programId, header.programId),
        inArray(programRoles.role, [...PROGRAM_STAFF_ROLES]),
        or(isNull(programRoles.seasonId), eq(programRoles.seasonId, header.seasonId)),
        isNull(users.deletedAt)
      )
    )
    .orderBy(asc(users.name));

  const athleteList = toEmergencyAthletes(rows, byAthlete);

  // One audit row per view. If this fails, the medical data is not returned.
  await writeAudit({
    actorUserId: ctx.userId,
    action: "medical.viewed",
    targetType: "season",
    targetId: header.seasonId,
    metadata: { seasonId: header.seasonId, athleteCount: athleteList.length },
  });

  const { customFormSchema: _omit, ...pub } = header;
  void _omit;
  return { header: pub, generatedAt: new Date(), athletes: athleteList, staff: staffRows };
}

// ---------------------------------------------------------------------------
// Team emergency sheet (team staff see their own team only)
// ---------------------------------------------------------------------------
export async function getTeamEmergencySheet(
  ctx: SessionContext,
  teamId: string,
  expectedProgramSlug?: string
): Promise<EmergencySheet> {
  const id = parseId(teamId, "Team");
  const [t] = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      division: teams.division,
      seasonId: seasons.id,
      seasonName: seasons.name,
      programId: programs.id,
      programName: programs.name,
      programSlug: programs.slug,
      programActive: programs.isActive,
      feeCents: seasons.baseFeeCents,
    })
    .from(teams)
    .innerJoin(seasons, eq(seasons.id, teams.seasonId))
    .innerJoin(programs, eq(programs.id, teams.programId))
    .where(and(eq(teams.id, id), isNull(programs.deletedAt)))
    .limit(1);
  // Team staff, program admins and the board only; everyone else gets a 404.
  if (!t || !canViewTeam(ctx, { id: t.teamId, programId: t.programId })) throw new DalError("NOT_FOUND", "Team not found.");
  if (!t.programActive && !isBoard(ctx)) throw new DalError("NOT_FOUND", "Team not found.");
  // Reject a mismatched URL before any medical data is read or audited.
  if (expectedProgramSlug !== undefined && t.programSlug !== expectedProgramSlug) {
    throw new DalError("NOT_FOUND", "Team not found.");
  }

  const rows = await db
    .select({
      registrationId: registrations.id,
      athleteId: athletes.id,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      dateOfBirth: athletes.dateOfBirth,
      photoObjectKey: athletes.photoObjectKey,
      photoUpdatedAt: athletes.photoUpdatedAt,
      medicalNotes: athletes.medicalNotes,
      emergencyContacts: athletes.emergencyContacts,
    })
    .from(teamPlayers)
    .innerJoin(registrations, eq(registrations.id, teamPlayers.registrationId))
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .where(and(eq(teamPlayers.teamId, t.teamId), isNull(teamPlayers.removedAt), isNull(registrations.deletedAt), isNull(athletes.deletedAt)))
    .orderBy(asc(athletes.lastName), asc(athletes.firstName));

  const byAthlete = await loadGuardiansByAthlete(rows.map((r) => r.athleteId));
  const staffRows = await db
    .select({ name: users.name, phone: users.phone, role: teamStaff.role })
    .from(teamStaff)
    .innerJoin(users, eq(users.id, teamStaff.userId))
    .where(and(eq(teamStaff.teamId, t.teamId), isNull(teamStaff.removedAt), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  const athleteList = toEmergencyAthletes(rows, byAthlete);

  // One audit row per view. If this fails, the medical data is not returned.
  await writeAudit({
    actorUserId: ctx.userId,
    action: "medical.viewed",
    targetType: "team",
    targetId: t.teamId,
    metadata: { teamId: t.teamId, seasonId: t.seasonId, athleteCount: athleteList.length },
  });

  return {
    header: {
      seasonId: t.seasonId,
      seasonName: t.seasonName,
      programId: t.programId,
      programName: t.programName,
      programSlug: t.programSlug,
      programActive: t.programActive,
      feeCents: t.feeCents,
      canManage: canManageProgram(ctx, t.programId),
      isBoard: isBoard(ctx),
    },
    team: { id: t.teamId, name: t.teamName, division: t.division },
    generatedAt: new Date(),
    athletes: athleteList,
    staff: staffRows,
  };
}
