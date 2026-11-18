import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { programs, seasons, users, volunteerLogs, volunteerRoleAssignments, volunteerRoles } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { utcToLaDateInput } from "@/lib/format";
import { inKindValueCents } from "@/lib/grant-rate";
import { fulfilmentPercent, type VolunteerRolePeriod } from "@/lib/volunteer-roles";
import { getInKindRateCents } from "./settings";
import { grantDateBounds, type GrantFilters } from "@/lib/validation/grants";
import type { VerificationMethod, VolunteerCategory } from "@/lib/volunteer-categories";
import { DalError, isBoard, type SessionContext } from "./context";

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

export interface GrantLedgerRow {
  id: string;
  /** LA calendar date, YYYY-MM-DD. */
  activityDate: string;
  activityAt: Date;
  userId: string;
  volunteerName: string;
  volunteerEmail: string;
  programId: string | null;
  programName: string | null;
  /** Volunteer role the hours were logged against (via the role assignment); null = "No role". */
  roleId: string | null;
  roleName: string | null;
  /** The role's own program (null for an org-wide role or no role). */
  roleProgramName: string | null;
  category: VolunteerCategory;
  minutes: number;
  /** Rate actually used for this row (snapshot, or current rate when the snapshot is null). */
  rateCents: number;
  rateIsFallback: boolean;
  /** inKindValueCents(minutes, rateCents): rounded once per row. The single source of truth for every total. */
  valueCents: number;
  verificationMethod: VerificationMethod;
  approvedByName: string | null;
  approvedAt: Date | null;
  description: string | null;
}

export interface GrantBucket {
  key: string;
  label: string;
  entries: number;
  minutes: number;
  valueCents: number;
}

export interface GrantRoleBucket extends GrantBucket {
  /** key = role id, or "none" for ledger rows without a role assignment. */
  programName: string | null;
  isOrgWide: boolean;
}

export interface GrantVolunteerBucket {
  userId: string;
  name: string;
  email: string;
  entries: number;
  minutes: number;
  valueCents: number;
}

export interface GrantReport {
  totals: { entries: number; volunteers: number; minutes: number; valueCents: number };
  byCategory: GrantBucket[];
  byProgram: GrantBucket[];
  byMonth: GrantBucket[];
  byVolunteer: GrantVolunteerBucket[];
  byRole: GrantRoleBucket[];
  /** Distinct per-hour rates used (cents), ascending; and how many rows fell back to the current rate. */
  rates: number[];
  fallbackRateEntries: number;
  currentRateCents: number;
}

function buildWhere(f: GrantFilters): SQL {
  const { start, end } = grantDateBounds(f);
  const conds: (SQL | undefined)[] = [
    isNull(volunteerLogs.deletedAt),
    gte(volunteerLogs.activityDate, start),
    lte(volunteerLogs.activityDate, end),
  ];
  if (f.program === "org") conds.push(isNull(volunteerLogs.programId));
  else if (f.program !== "all") conds.push(eq(volunteerLogs.programId, f.program));
  if (f.categories.length) conds.push(inArray(volunteerLogs.category, f.categories));
  if (f.role === "none") conds.push(isNull(volunteerLogs.volunteerRoleAssignmentId));
  else if (f.role !== "all") conds.push(eq(volunteerRoles.id, f.role));
  if (f.verification === "verified") {
    conds.push(inArray(volunteerLogs.verificationMethod, ["shift_checkin", "admin_approved"]));
  } else if (f.verification !== "all") {
    conds.push(eq(volunteerLogs.verificationMethod, f.verification));
  }
  return and(...conds)!;
}

async function fetchRows(f: GrantFilters): Promise<GrantLedgerRow[]> {
  const approver = alias(users, "approver");
  const roleProgram = alias(programs, "role_program");
  const currentRate = await getInKindRateCents();
  const rows = await db
    .select({
      id: volunteerLogs.id,
      activityAt: volunteerLogs.activityDate,
      userId: volunteerLogs.userId,
      volunteerName: users.name,
      volunteerEmail: users.email,
      programId: volunteerLogs.programId,
      programName: programs.name,
      roleId: volunteerRoles.id,
      roleName: volunteerRoles.name,
      roleProgramName: roleProgram.name,
      category: volunteerLogs.category,
      minutes: volunteerLogs.durationMinutes,
      snapshotRate: volunteerLogs.inKindRateCents,
      verificationMethod: volunteerLogs.verificationMethod,
      approvedByName: approver.name,
      approvedAt: volunteerLogs.approvedAt,
      description: volunteerLogs.description,
    })
    .from(volunteerLogs)
    .innerJoin(users, eq(users.id, volunteerLogs.userId))
    .leftJoin(programs, eq(programs.id, volunteerLogs.programId))
    .leftJoin(approver, eq(approver.id, volunteerLogs.approvedByUserId))
    .leftJoin(volunteerRoleAssignments, eq(volunteerRoleAssignments.id, volunteerLogs.volunteerRoleAssignmentId))
    .leftJoin(volunteerRoles, eq(volunteerRoles.id, volunteerRoleAssignments.roleId))
    .leftJoin(roleProgram, eq(roleProgram.id, volunteerRoles.programId))
    .where(buildWhere(f))
    .orderBy(asc(volunteerLogs.activityDate), asc(volunteerLogs.createdAt), asc(volunteerLogs.id));

  return rows.map(({ snapshotRate, ...r }) => {
    const rateCents = snapshotRate ?? currentRate;
    return {
      ...r,
      activityDate: utcToLaDateInput(r.activityAt),
      rateCents,
      rateIsFallback: snapshotRate === null,
      valueCents: inKindValueCents(r.minutes, rateCents),
    };
  });
}

function bucketize<T extends { key: string; label: string }>(
  rows: GrantLedgerRow[],
  pick: (r: GrantLedgerRow) => T,
  sort: (a: GrantBucket, b: GrantBucket) => number,
): GrantBucket[] {
  const map = new Map<string, GrantBucket>();
  for (const r of rows) {
    const { key, label } = pick(r);
    const b = map.get(key) ?? { key, label, entries: 0, minutes: 0, valueCents: 0 };
    b.entries += 1;
    b.minutes += r.minutes;
    b.valueCents += r.valueCents;
    map.set(key, b);
  }
  return [...map.values()].sort(sort);
}

const byMinutesDesc = (a: GrantBucket, b: GrantBucket) =>
  b.minutes - a.minutes || a.label.localeCompare(b.label);

/** Pure aggregation over ledger rows (exported for tests). Every total is a sum of `valueCents` / `minutes` of the same rows the CSV lists. */
export function aggregateGrantRows(rows: GrantLedgerRow[], currentRateCents: number): GrantReport {
  const vol = new Map<string, GrantVolunteerBucket>();
  for (const r of rows) {
    const v =
      vol.get(r.userId) ??
      { userId: r.userId, name: r.volunteerName, email: r.volunteerEmail, entries: 0, minutes: 0, valueCents: 0 };
    v.entries += 1;
    v.minutes += r.minutes;
    v.valueCents += r.valueCents;
    vol.set(r.userId, v);
  }
  const roles = new Map<string, GrantRoleBucket>();
  for (const r of rows) {
    const key = r.roleId ?? "none";
    const b =
      roles.get(key) ??
      {
        key,
        label: r.roleName ?? "No role",
        programName: r.roleId ? (r.roleProgramName ?? "Org-wide") : null,
        isOrgWide: !!r.roleId && !r.roleProgramName,
        entries: 0,
        minutes: 0,
        valueCents: 0,
      };
    b.entries += 1;
    b.minutes += r.minutes;
    b.valueCents += r.valueCents;
    roles.set(key, b);
  }
  return {
    totals: {
      entries: rows.length,
      volunteers: vol.size,
      minutes: rows.reduce((s, r) => s + r.minutes, 0),
      valueCents: rows.reduce((s, r) => s + r.valueCents, 0),
    },
    byCategory: bucketize(rows, (r) => ({ key: r.category, label: r.category }), byMinutesDesc),
    byProgram: bucketize(
      rows,
      (r) => ({ key: r.programId ?? "org", label: r.programName ?? "Org-wide (no program)" }),
      byMinutesDesc,
    ),
    byMonth: bucketize(
      rows,
      (r) => ({ key: r.activityDate.slice(0, 7), label: r.activityDate.slice(0, 7) }),
      (a, b) => a.key.localeCompare(b.key),
    ),
    byVolunteer: [...vol.values()].sort(
      (a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
    ),
    byRole: [...roles.values()].sort(
      (a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
    ),
    rates: [...new Set(rows.map((r) => r.rateCents))].sort((a, b) => a - b),
    fallbackRateEntries: rows.filter((r) => r.rateIsFallback).length,
    currentRateCents,
  };
}

/**
 * Board-only grant report. Excludes soft-deleted rows; date range is inclusive LA calendar days;
 * value per row uses the rate snapshot (current rate only when null), rounded once per row.
 * Pass `{ audit: false }` when the caller records its own audit event (the print view).
 */
export async function getGrantReport(
  ctx: SessionContext,
  filters: GrantFilters,
  opts: { audit?: boolean } = {},
): Promise<GrantReport> {
  requireBoard(ctx);
  const report = aggregateGrantRows(await fetchRows(filters), await getInKindRateCents());
  if (opts.audit !== false) {
    await writeAudit({
      actorUserId: ctx.userId,
      action: "grant.report_viewed",
      targetType: "grant_report",
      targetId: "volunteer_hours",
      metadata: { filters, entries: report.totals.entries },
    });
  }
  return report;
}

export interface GrantRoleOption {
  id: string;
  name: string;
  programName: string | null;
}

/** Board-only: every volunteer role (archived included, they may still have hours) for the report's role filter. */
export async function listGrantRoleOptions(ctx: SessionContext): Promise<GrantRoleOption[]> {
  requireBoard(ctx);
  return db
    .select({ id: volunteerRoles.id, name: volunteerRoles.name, programName: programs.name })
    .from(volunteerRoles)
    .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
    .orderBy(asc(programs.name), asc(volunteerRoles.name), asc(volunteerRoles.id));
}

/** Board-only: every ledger row matching the filters (for the CSV). */
export async function listGrantLedgerRows(ctx: SessionContext, filters: GrantFilters): Promise<GrantLedgerRow[]> {
  requireBoard(ctx);
  return fetchRows(filters);
}

/** Board-only: audit a CSV download or print view. */
export async function recordGrantExport(
  ctx: SessionContext,
  filters: GrantFilters,
  info: { format: "csv" | "print"; rowCount: number },
): Promise<void> {
  requireBoard(ctx);
  await writeAudit({
    actorUserId: ctx.userId,
    action: "grant.exported",
    targetType: "grant_report",
    targetId: "volunteer_hours",
    metadata: { filters, format: info.format, rowCount: info.rowCount },
  });
}

// ---------------------------------------------------------------------------
// Role commitments (expected vs delivered volunteer-role hours)
// ---------------------------------------------------------------------------

export interface RoleCommitmentRow {
  roleId: string;
  roleName: string;
  programName: string | null;
  period: VolunteerRolePeriod;
  /** Active + ended assignments whose term overlaps the report range. */
  assignments: number;
  /** Sum of the assignments' expectedMinutes snapshots. */
  expectedMinutes: number;
  /** Verified (not self-reported), live ledger minutes against those assignments, all-time. */
  verifiedMinutes: number;
  /** verified / expected, 0-999; null when nothing is expected. */
  fulfilmentPercent: number | null;
  /** Sum over assignments of inKindValueCents(expected, current rate). */
  projectedValueCents: number;
  /** Sum over verified ledger rows of inKindValueCents(minutes, row rate snapshot; current rate if null). */
  actualValueCents: number;
}

export interface RoleCommitments {
  rows: RoleCommitmentRow[];
  totals: Omit<RoleCommitmentRow, "roleId" | "roleName" | "programName" | "period">;
  currentRateCents: number;
}

/** Does a term overlap the inclusive LA-day range [from, to] (YYYY-MM-DD strings)? */
export function termOverlapsRange(
  term: { year: number | null; startsOn: string | null; endsOn: string | null; seasonCreatedAt: Date | null },
  range: { from: string; to: string },
): boolean {
  if (term.year !== null) return `${term.year}-01-01` <= range.to && `${term.year}-12-31` >= range.from;
  if (!term.startsOn && !term.endsOn) {
    // Season without dates: counts by the season's createdAt year (LA time).
    const y = term.seasonCreatedAt ? utcToLaDateInput(term.seasonCreatedAt).slice(0, 4) : null;
    return y !== null && `${y}-01-01` <= range.to && `${y}-12-31` >= range.from;
  }
  return (term.startsOn ?? "0000-01-01") <= range.to && (term.endsOn ?? "9999-12-31") >= range.from;
}

/**
 * Board-only "what match did we commit, and what was delivered". Terms = active/ended assignments whose
 * term overlaps the filter date range (pending, declined and withdrawn never count). Delivery is all-time
 * for each assignment, not limited to the date range. The program and role filters narrow the roles
 * (role "none" has no commitments).
 */
export async function getRoleCommitments(ctx: SessionContext, filters: GrantFilters): Promise<RoleCommitments> {
  requireBoard(ctx);
  const currentRate = await getInKindRateCents();
  const empty: RoleCommitments = {
    rows: [],
    totals: { assignments: 0, expectedMinutes: 0, verifiedMinutes: 0, fulfilmentPercent: null, projectedValueCents: 0, actualValueCents: 0 },
    currentRateCents: currentRate,
  };
  if (filters.role === "none") return empty;

  const conds: (SQL | undefined)[] = [inArray(volunteerRoleAssignments.status, ["active", "ended"])];
  if (filters.program === "org") conds.push(isNull(volunteerRoles.programId));
  else if (filters.program !== "all") conds.push(eq(volunteerRoles.programId, filters.program));
  if (filters.role !== "all") conds.push(eq(volunteerRoles.id, filters.role));

  const candidates = await db
    .select({
      id: volunteerRoleAssignments.id,
      roleId: volunteerRoles.id,
      roleName: volunteerRoles.name,
      period: volunteerRoles.period,
      programName: programs.name,
      expectedMinutes: volunteerRoleAssignments.expectedMinutes,
      year: volunteerRoleAssignments.year,
      startsOn: seasons.startsOn,
      endsOn: seasons.endsOn,
      seasonCreatedAt: seasons.createdAt,
    })
    .from(volunteerRoleAssignments)
    .innerJoin(volunteerRoles, eq(volunteerRoles.id, volunteerRoleAssignments.roleId))
    .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
    .leftJoin(seasons, eq(seasons.id, volunteerRoleAssignments.seasonId))
    .where(and(...conds));
  const terms = candidates.filter((c) => termOverlapsRange(c, filters));
  if (terms.length === 0) return empty;

  // Verified, live ledger rows against these assignments (all-time), valued per row like the grant report.
  const ledger = await db
    .select({
      assignmentId: volunteerLogs.volunteerRoleAssignmentId,
      minutes: volunteerLogs.durationMinutes,
      snapshotRate: volunteerLogs.inKindRateCents,
    })
    .from(volunteerLogs)
    .where(
      and(
        inArray(volunteerLogs.volunteerRoleAssignmentId, terms.map((t) => t.id)),
        isNull(volunteerLogs.deletedAt),
        sql`${volunteerLogs.verificationMethod} <> 'self_reported'`,
      ),
    );
  const byAssignment = new Map<string, { minutes: number; valueCents: number }>();
  for (const l of ledger) {
    const k = l.assignmentId as string;
    const cur = byAssignment.get(k) ?? { minutes: 0, valueCents: 0 };
    cur.minutes += l.minutes;
    cur.valueCents += inKindValueCents(l.minutes, l.snapshotRate ?? currentRate);
    byAssignment.set(k, cur);
  }

  const roles = new Map<string, RoleCommitmentRow>();
  for (const t of terms) {
    const exp = t.expectedMinutes ?? 0;
    const got = byAssignment.get(t.id) ?? { minutes: 0, valueCents: 0 };
    const r =
      roles.get(t.roleId) ??
      {
        roleId: t.roleId,
        roleName: t.roleName,
        programName: t.programName,
        period: t.period,
        assignments: 0,
        expectedMinutes: 0,
        verifiedMinutes: 0,
        fulfilmentPercent: null,
        projectedValueCents: 0,
        actualValueCents: 0,
      };
    r.assignments += 1;
    r.expectedMinutes += exp;
    r.verifiedMinutes += got.minutes;
    r.projectedValueCents += inKindValueCents(exp, currentRate);
    r.actualValueCents += got.valueCents;
    roles.set(t.roleId, r);
  }
  const rows = [...roles.values()]
    .map((r) => ({ ...r, fulfilmentPercent: fulfilmentPercent(r.verifiedMinutes, r.expectedMinutes) }))
    .sort((a, b) => (a.programName ?? "").localeCompare(b.programName ?? "") || a.roleName.localeCompare(b.roleName) || a.roleId.localeCompare(b.roleId));
  const sum = (f: (r: RoleCommitmentRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const expectedMinutes = sum((r) => r.expectedMinutes);
  const verifiedMinutes = sum((r) => r.verifiedMinutes);
  return {
    rows,
    totals: {
      assignments: sum((r) => r.assignments),
      expectedMinutes,
      verifiedMinutes,
      fulfilmentPercent: fulfilmentPercent(verifiedMinutes, expectedMinutes),
      projectedValueCents: sum((r) => r.projectedValueCents),
      actualValueCents: sum((r) => r.actualValueCents),
    },
    currentRateCents: currentRate,
  };
}
