import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { programs, users, volunteerLogs } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { utcToLaDateInput } from "@/lib/format";
import { inKindValueCents } from "@/lib/grant-rate";
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
  if (f.verification === "verified") {
    conds.push(inArray(volunteerLogs.verificationMethod, ["shift_checkin", "admin_approved"]));
  } else if (f.verification !== "all") {
    conds.push(eq(volunteerLogs.verificationMethod, f.verification));
  }
  return and(...conds)!;
}

async function fetchRows(f: GrantFilters): Promise<GrantLedgerRow[]> {
  const approver = alias(users, "approver");
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
