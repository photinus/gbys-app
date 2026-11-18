import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  athletes,
  programs,
  registrations,
  seasons,
  userCredentials,
  users,
  volunteerLogs,
  volunteerShiftSignups,
  volunteerRoleAssignments,
  volunteerShifts,
  waiverVersions,
} from "@/db/schema";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import { isFeatureEnabled } from "@/lib/features";
import { defaultGrantFilters } from "@/lib/validation/grants";
import { computeSeasonStatus } from "@/lib/validation/seasons";
import { DalError, isBoard, type SessionContext } from "./context";
import { getGrantReport, getRoleCommitments, termOverlapsRange } from "./grants";

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_DAYS = 30; // same window as the compliance summary / queue

export interface OverviewSeason {
  id: string;
  name: string;
  programId: string;
  programName: string;
  registrationClosesAt: Date | null;
  /** Live registrations (athlete not deleted). */
  registrations: number;
}

export interface AdminOverview {
  year: number;
  now: Date;
  kpis: {
    activeVolunteers: number;
    /** Credentials verified during the current LA calendar month (the "+N this month" delta). */
    verifiedThisMonth: number;
    /** Distinct athletes with a live registration in an active season. */
    registeredAthletes: number;
    /** Live registrations in active seasons (an athlete in two seasons counts twice). */
    activeRegistrations: number;
    activeSeasons: number;
    /** Same rows and rounding as /admin/grants with its default filters for this LA year. */
    ytdMinutes: number;
    ytdValueCents: number;
    ytdEntries: number;
    currentRateCents: number;
    partnerLeagues: number;
    partnerLeagueNames: string[];
  };
  attention: {
    pendingCredentials: number;
    expiringCredentials: number;
    pendingHours: number;
    unpaidRegistrations: number;
    /** Unpaid registrations in open seasons, grouped by program (links to the program hub). */
    unpaidByProgram: { programId: string; programName: string; count: number }[];
    bouncedEmails: number;
    /** Open seasons whose waiver text still contains "DRAFT". */
    /** Volunteer role sign-ups (status pending) waiting for a manager's decision, all programs. */
    pendingRoleSignups: number;
    draftWaiverSeasons: { seasonId: string; seasonName: string; programId: string; programName: string }[];
  };
  /** Volunteer roles card. Terms = assignments whose term overlaps the current LA year (same rule as /admin/grants). */
  volunteerRoles: {
    /** Assignments with status active whose term overlaps the current year. */
    activeAssignments: number;
    pendingApprovals: number;
    /** Active + ended assignments overlapping this year: sum of snapshots vs verified logged minutes (== Role commitments totals). */
    expectedMinutes: number;
    verifiedMinutes: number;
    fulfilmentPercent: number | null;
  };
  /** FEATURE_VOLUNTEER_SHIFTS: when false, upcomingShifts is empty and the page hides the card. */
  shiftsEnabled: boolean;
  upcomingShifts: {
    count: number;
    next: {
      id: string;
      title: string;
      programName: string | null;
      startsAt: Date;
      endsAt: Date;
      spotsTotal: number;
      spotsFilled: number;
    }[];
  };
  openSeasons: OverviewSeason[];
}

/**
 * Board-only dashboard numbers. Definitions deliberately reuse the rest of the app:
 *  - YTD hours/value come from getGrantReport() with the default grant filters (verified = shift_checkin +
 *    admin_approved, soft-deleted rows excluded, Jan 1 .. today in LA time), so they equal /admin/grants.
 *  - "open" seasons use computeSeasonStatus().
 *  - pending credentials / expiring match getComplianceSummary() and the verification queue (soft-deleted
 *    users excluded); pending hours match listPendingHours().
 */
export async function getAdminOverview(ctx: SessionContext, now: Date = new Date()): Promise<AdminOverview> {
  requireBoard(ctx);

  const today = utcToLaDateInput(now);
  const year = Number(today.slice(0, 4));
  const monthStart = laDateInputToUtc(`${today.slice(0, 7)}-01`, false);
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS);
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS);
  const shiftsEnabled = isFeatureEnabled("volunteerShifts");
  const yearRange = { from: `${year}-01-01`, to: `${year}-12-31` };

  const [
    activeVolRow,
    verifiedMonthRow,
    partnerRows,
    credRow,
    hoursRow,
    bouncedRow,
    seasonRows,
    shiftCountRow,
    shiftRows,
    grant,
    commitments,
    roleStatusRows,
  ] = await Promise.all([
    db
      .select({ n: sql<number>`count(distinct ${userCredentials.userId})::int` })
      .from(userCredentials)
      .innerJoin(users, eq(users.id, userCredentials.userId))
      .where(
        and(
          isNull(users.deletedAt),
          eq(userCredentials.status, "verified"),
          sql`(${userCredentials.expiresAt} is null or ${userCredentials.expiresAt} >= ${now})`,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(userCredentials)
      .innerJoin(users, eq(users.id, userCredentials.userId))
      .where(
        and(isNull(users.deletedAt), eq(userCredentials.status, "verified"), gte(userCredentials.verifiedAt, monthStart)),
      ),
    db
      .select({ name: programs.name })
      .from(programs)
      .where(and(eq(programs.isActive, true), isNull(programs.deletedAt), eq(programs.isIndependentPartner, true)))
      .orderBy(asc(programs.name)),
    db
      .select({
        pending: sql<number>`count(*) filter (where ${userCredentials.status} = 'pending_review')::int`,
        expiring: sql<number>`count(*) filter (where ${userCredentials.status} = 'verified' and ${userCredentials.expiresAt} >= ${now} and ${userCredentials.expiresAt} <= ${soon})::int`,
      })
      .from(userCredentials)
      .innerJoin(users, eq(users.id, userCredentials.userId))
      .where(isNull(users.deletedAt)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(volunteerLogs)
      .innerJoin(users, eq(users.id, volunteerLogs.userId))
      .where(and(eq(volunteerLogs.verificationMethod, "self_reported"), isNull(volunteerLogs.deletedAt))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.emailBounced, true))),
    // Every active season of a live program; "open"/"draft waiver" are decided in JS via computeSeasonStatus.
    db
      .select({
        id: seasons.id,
        name: seasons.name,
        programId: seasons.programId,
        programName: programs.name,
        isActive: seasons.isActive,
        waiverVersionId: seasons.waiverVersionId,
        registrationOpensAt: seasons.registrationOpensAt,
        registrationClosesAt: seasons.registrationClosesAt,
        draftWaiver: sql<boolean>`coalesce(${waiverVersions.body} ~* '\\mdraft\\M', false)`,
      })
      .from(seasons)
      .innerJoin(programs, eq(programs.id, seasons.programId))
      .leftJoin(waiverVersions, eq(waiverVersions.id, seasons.waiverVersionId))
      .where(and(eq(seasons.isActive, true), isNull(programs.deletedAt)))
      .orderBy(asc(programs.name), asc(seasons.name)),
    shiftsEnabled
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(volunteerShifts)
          .where(
            and(isNull(volunteerShifts.cancelledAt), gte(volunteerShifts.startsAt, now), lt(volunteerShifts.startsAt, weekAhead)),
          )
      : Promise.resolve([{ n: 0 }]),
    (shiftsEnabled ? db
      .select({
        id: volunteerShifts.id,
        title: volunteerShifts.title,
        programName: programs.name,
        startsAt: volunteerShifts.startsAt,
        endsAt: volunteerShifts.endsAt,
        spotsTotal: volunteerShifts.spotsTotal,
        spotsFilled: sql<number>`(select count(*)::int from ${volunteerShiftSignups} s where s.shift_id = ${volunteerShifts.id} and s.cancelled_at is null)`,
      })
      .from(volunteerShifts)
      .leftJoin(programs, eq(programs.id, volunteerShifts.programId))
      .where(
        and(isNull(volunteerShifts.cancelledAt), gte(volunteerShifts.startsAt, now), lt(volunteerShifts.startsAt, weekAhead)),
      )
      .orderBy(asc(volunteerShifts.startsAt), asc(volunteerShifts.id))
      .limit(3) : Promise.resolve([])) as Promise<AdminOverview["upcomingShifts"]["next"]>,
    getGrantReport(ctx, defaultGrantFilters(now), { audit: false }),
    getRoleCommitments(ctx, { ...defaultGrantFilters(now), ...yearRange, verification: "all" }),
    // Candidate assignments for the roles card / attention item; the year overlap is decided in JS (termOverlapsRange).
    db
      .select({
        status: volunteerRoleAssignments.status,
        year: volunteerRoleAssignments.year,
        startsOn: seasons.startsOn,
        endsOn: seasons.endsOn,
        seasonCreatedAt: seasons.createdAt,
      })
      .from(volunteerRoleAssignments)
      .leftJoin(seasons, eq(seasons.id, volunteerRoleAssignments.seasonId))
      .where(inArray(volunteerRoleAssignments.status, ["pending", "active"])),
  ]);

  const activeSeasons = seasonRows;
  const open = seasonRows.filter((s) => computeSeasonStatus(s, now) === "open");
  const activeSeasonIds = activeSeasons.map((s) => s.id);

  // Live registrations per active season (athlete not soft-deleted).
  const regRows = activeSeasonIds.length
    ? await db
        .select({
          seasonId: registrations.seasonId,
          total: sql<number>`count(*)::int`,
          unpaid: sql<number>`count(*) filter (where ${registrations.paymentStatus} = 'unpaid')::int`,
        })
        .from(registrations)
        .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
        .where(
          and(
            inArray(registrations.seasonId, activeSeasonIds),
            isNull(registrations.deletedAt),
            isNull(athletes.deletedAt),
          ),
        )
        .groupBy(registrations.seasonId)
    : [];
  const regBySeason = new Map(regRows.map((r) => [r.seasonId, r]));

  const [athleteRow] = activeSeasonIds.length
    ? await db
        .select({ n: sql<number>`count(distinct ${registrations.athleteId})::int` })
        .from(registrations)
        .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
        .where(
          and(
            inArray(registrations.seasonId, activeSeasonIds),
            isNull(registrations.deletedAt),
            isNull(athletes.deletedAt),
          ),
        )
    : [{ n: 0 }];

  const unpaidMap = new Map<string, { programId: string; programName: string; count: number }>();
  for (const s of open) {
    const unpaid = regBySeason.get(s.id)?.unpaid ?? 0;
    if (!unpaid) continue;
    const cur = unpaidMap.get(s.programId) ?? { programId: s.programId, programName: s.programName, count: 0 };
    cur.count += unpaid;
    unpaidMap.set(s.programId, cur);
  }
  const unpaidByProgram = [...unpaidMap.values()].sort(
    (a, b) => b.count - a.count || a.programName.localeCompare(b.programName),
  );

  const pendingRoleSignups = roleStatusRows.filter((r) => r.status === "pending").length;
  const activeThisYear = roleStatusRows.filter((r) => r.status === "active" && termOverlapsRange(r, yearRange)).length;

  return {
    year,
    now,
    kpis: {
      activeVolunteers: activeVolRow[0]?.n ?? 0,
      verifiedThisMonth: verifiedMonthRow[0]?.n ?? 0,
      registeredAthletes: athleteRow?.n ?? 0,
      activeRegistrations: regRows.reduce((s, r) => s + r.total, 0),
      activeSeasons: activeSeasons.length,
      ytdMinutes: grant.totals.minutes,
      ytdValueCents: grant.totals.valueCents,
      ytdEntries: grant.totals.entries,
      currentRateCents: grant.currentRateCents,
      partnerLeagues: partnerRows.length,
      partnerLeagueNames: partnerRows.map((p) => p.name),
    },
    attention: {
      pendingCredentials: credRow[0]?.pending ?? 0,
      expiringCredentials: credRow[0]?.expiring ?? 0,
      pendingHours: hoursRow[0]?.n ?? 0,
      unpaidRegistrations: unpaidByProgram.reduce((s, p) => s + p.count, 0),
      unpaidByProgram,
      bouncedEmails: bouncedRow[0]?.n ?? 0,
      pendingRoleSignups,
      draftWaiverSeasons: open
        .filter((s) => s.draftWaiver)
        .map((s) => ({ seasonId: s.id, seasonName: s.name, programId: s.programId, programName: s.programName })),
    },
    volunteerRoles: {
      activeAssignments: activeThisYear,
      pendingApprovals: pendingRoleSignups,
      expectedMinutes: commitments.totals.expectedMinutes,
      verifiedMinutes: commitments.totals.verifiedMinutes,
      fulfilmentPercent: commitments.totals.fulfilmentPercent,
    },
    shiftsEnabled,
    upcomingShifts: { count: shiftCountRow[0]?.n ?? 0, next: shiftRows },
    openSeasons: open.map((s) => ({
      id: s.id,
      name: s.name,
      programId: s.programId,
      programName: s.programName,
      registrationClosesAt: s.registrationClosesAt,
      registrations: regBySeason.get(s.id)?.total ?? 0,
    })),
  };
}
