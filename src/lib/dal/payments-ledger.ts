import "server-only";
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { athletes, paymentEventKindEnum, paymentEvents, programs, registrations, seasons, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { laDateInputToUtc, utcToLaDateInput, formatTime } from "@/lib/format";
import { DalError, isBoard, type SessionContext } from "./context";
import { assertProgramReachable, canManageProgram } from "./permissions";

/**
 * Read side of the append-only payment ledger (`payment_events`). Rows are only
 * ever written by the Stripe webhook handlers and the offline payment/void DAL.
 * Program admins see their program; the board sees every program.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type LedgerKind = (typeof paymentEventKindEnum.enumValues)[number];
export const LEDGER_KINDS: readonly LedgerKind[] = paymentEventKindEnum.enumValues;
export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  charge: "Card payment",
  refund: "Refund",
  dispute_opened: "Dispute opened",
  dispute_closed: "Dispute closed",
  offline_payment: "Offline payment",
  offline_void: "Offline void",
};

export const LEDGER_PAGE_SIZE = 50;
const EXPORT_ROW_CAP = 20_000;

export interface LedgerFilter {
  /** Program id. Omitted/null = all programs (board only). */
  programId?: string | null;
  /** YYYY-MM-DD in America/Los_Angeles, inclusive. */
  from?: string | null;
  to?: string | null;
  kind?: LedgerKind | null;
}

export interface LedgerRow {
  id: string;
  registrationId: string;
  programId: string | null;
  programName: string | null;
  programSlug: string | null;
  seasonName: string;
  athleteName: string;
  kind: LedgerKind;
  amountCents: number;
  applicationFeeCents: number | null;
  stripeObjectId: string | null;
  stripeAccountId: string | null;
  method: "stripe" | "cash" | "check" | "scholarship" | null;
  note: string | null;
  /** null = the Stripe webhook */
  recordedByName: string | null;
  occurredAt: Date;
}

export interface LedgerTotals {
  /** charge + offline_payment */
  grossCents: number;
  refundedCents: number;
  voidedCents: number;
  /** gross - refunded - voided */
  netCents: number;
  /** application fees on card charges (partner programs) */
  platformFeesCents: number;
  disputedCents: number;
  disputeCount: number;
  eventCount: number;
}

export interface LedgerPage {
  rows: LedgerRow[];
  totals: LedgerTotals;
  nextCursor: string | null;
}

function parseCursor(cursor: string | null | undefined): { ts: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!ts || !id || !UUID_RE.test(id) || Number.isNaN(Date.parse(ts))) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

function cursorFor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, "utf8").toString("base64url");
}

/** Validates and authorizes a filter; returns the SQL conditions that implement it. */
async function buildWhere(ctx: SessionContext, f: LedgerFilter): Promise<SQL[]> {
  const conds: SQL[] = [];
  if (f.programId) {
    if (!UUID_RE.test(f.programId)) throw new DalError("NOT_FOUND", "Program not found.");
    if (!canManageProgram(ctx, f.programId)) {
      throw new DalError("FORBIDDEN", "You do not have permission to view this ledger.");
    }
    await assertProgramReachable(ctx, f.programId);
    conds.push(eq(paymentEvents.programId, f.programId));
  } else if (!isBoard(ctx)) {
    throw new DalError("FORBIDDEN", "Only the board can view the all-program ledger.");
  }
  if (f.from) {
    if (!DATE_RE.test(f.from)) throw new DalError("INVALID", "Enter a valid start date.");
    conds.push(gte(paymentEvents.occurredAt, laDateInputToUtc(f.from, false)));
  }
  if (f.to) {
    if (!DATE_RE.test(f.to)) throw new DalError("INVALID", "Enter a valid end date.");
    conds.push(lte(paymentEvents.occurredAt, laDateInputToUtc(f.to, true)));
  }
  if (f.kind) {
    if (!LEDGER_KINDS.includes(f.kind)) throw new DalError("INVALID", "Unknown event type.");
    conds.push(eq(paymentEvents.kind, f.kind));
  }
  return conds;
}

/** Parses untrusted query-string values into a LedgerFilter (invalid values are dropped). */
export function parseLedgerFilter(sp: { from?: string; to?: string; kind?: string; program?: string }): LedgerFilter {
  return {
    programId: sp.program && UUID_RE.test(sp.program) ? sp.program : null,
    from: sp.from && DATE_RE.test(sp.from) ? sp.from : null,
    to: sp.to && DATE_RE.test(sp.to) ? sp.to : null,
    kind: sp.kind && (LEDGER_KINDS as readonly string[]).includes(sp.kind) ? (sp.kind as LedgerKind) : null,
  };
}

const TS_ISO = sql<string>`to_char(${paymentEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

async function totalsFor(conds: SQL[]): Promise<LedgerTotals> {
  const k = paymentEvents.kind;
  const amt = paymentEvents.amountCents;
  const [r] = await db
    .select({
      gross: sql<number>`coalesce(sum(${amt}) filter (where ${k} in ('charge','offline_payment')), 0)::int`,
      refunded: sql<number>`coalesce(sum(${amt}) filter (where ${k} = 'refund'), 0)::int`,
      voided: sql<number>`coalesce(sum(${amt}) filter (where ${k} = 'offline_void'), 0)::int`,
      fees: sql<number>`coalesce(sum(${paymentEvents.applicationFeeCents}) filter (where ${k} = 'charge'), 0)::int`,
      disputed: sql<number>`coalesce(sum(${amt}) filter (where ${k} = 'dispute_opened'), 0)::int`,
      disputeCount: sql<number>`count(*) filter (where ${k} = 'dispute_opened')::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(paymentEvents)
    .where(conds.length ? and(...conds) : undefined);
  return {
    grossCents: r.gross,
    refundedCents: r.refunded,
    voidedCents: r.voided,
    netCents: r.gross - r.refunded - r.voided,
    platformFeesCents: r.fees,
    disputedCents: r.disputed,
    disputeCount: r.disputeCount,
    eventCount: r.count,
  };
}

async function selectRows(conds: SQL[], limit: number) {
  return db
    .select({
      id: paymentEvents.id,
      registrationId: paymentEvents.registrationId,
      programId: paymentEvents.programId,
      programName: programs.name,
      programSlug: programs.slug,
      seasonName: seasons.name,
      athleteFirst: athletes.firstName,
      athleteLast: athletes.lastName,
      kind: paymentEvents.kind,
      amountCents: paymentEvents.amountCents,
      applicationFeeCents: paymentEvents.applicationFeeCents,
      stripeObjectId: paymentEvents.stripeObjectId,
      stripeAccountId: paymentEvents.stripeAccountId,
      method: paymentEvents.method,
      note: paymentEvents.note,
      recordedByName: users.name,
      occurredAt: paymentEvents.occurredAt,
      ts: TS_ISO,
    })
    .from(paymentEvents)
    .innerJoin(registrations, eq(registrations.id, paymentEvents.registrationId))
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .leftJoin(programs, eq(programs.id, paymentEvents.programId))
    .leftJoin(users, eq(users.id, paymentEvents.recordedByUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(paymentEvents.occurredAt), desc(paymentEvents.id))
    .limit(limit);
}

type SelectedRow = Awaited<ReturnType<typeof selectRows>>[number];
function toRow(r: SelectedRow): LedgerRow {
  return {
    id: r.id,
    registrationId: r.registrationId,
    programId: r.programId,
    programName: r.programName,
    programSlug: r.programSlug,
    seasonName: r.seasonName,
    athleteName: `${r.athleteFirst} ${r.athleteLast}`.trim(),
    kind: r.kind,
    amountCents: r.amountCents,
    applicationFeeCents: r.applicationFeeCents,
    stripeObjectId: r.stripeObjectId,
    stripeAccountId: r.stripeAccountId,
    method: r.method,
    note: r.note,
    recordedByName: r.recordedByName,
    occurredAt: r.occurredAt,
  };
}

/**
 * One page of the ledger (newest first) with totals for the WHOLE filtered range.
 * Keyset pagination on (occurred_at desc, id desc): the cursor carries the
 * microsecond-precision timestamp as text, so pages never skip or repeat rows.
 */
export async function listLedger(
  ctx: SessionContext,
  filter: LedgerFilter & { cursor?: string | null; limit?: number }
): Promise<LedgerPage> {
  const conds = await buildWhere(ctx, filter);
  const limit = Math.min(Math.max(filter.limit ?? LEDGER_PAGE_SIZE, 1), 200);
  const cur = parseCursor(filter.cursor);
  const pageConds = cur
    ? [...conds, sql`(${paymentEvents.occurredAt}, ${paymentEvents.id}) < (${cur.ts}::timestamptz, ${cur.id}::uuid)`]
    : conds;
  const [fetched, totals] = await Promise.all([selectRows(pageConds, limit + 1), totalsFor(conds)]);
  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;
  const last = page[page.length - 1];
  return {
    rows: page.map(toRow),
    totals,
    nextCursor: hasMore && last ? cursorFor(last.ts, last.id) : null,
  };
}

/** Resolve a program slug for a ledger page; hides existence from non-managers. */
export async function getLedgerProgram(
  ctx: SessionContext,
  slug: string
): Promise<{ id: string; name: string; slug: string; isIndependentPartner: boolean }> {
  const [p] = await db
    .select({ id: programs.id, name: programs.name, slug: programs.slug, isIndependentPartner: programs.isIndependentPartner })
    .from(programs)
    .where(and(eq(programs.slug, slug), isNull(programs.deletedAt)))
    .limit(1);
  if (!p || !canManageProgram(ctx, p.id)) throw new DalError("NOT_FOUND", "Program not found.");
  await assertProgramReachable(ctx, p.id);
  return p;
}

/** Programs for the board-wide filter. */
export async function listLedgerPrograms(ctx: SessionContext): Promise<{ id: string; name: string }[]> {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "Only the board can view the all-program ledger.");
  return db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(isNull(programs.deletedAt))
    .orderBy(programs.name);
}

const DIRECTION: Record<LedgerKind, "in" | "out" | "info"> = {
  charge: "in",
  offline_payment: "in",
  refund: "out",
  offline_void: "out",
  dispute_opened: "info",
  dispute_closed: "info",
};

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** CSV text for the filtered range (one row per event, LA dates). Injection-guarded via toCsv. */
export function buildLedgerCsv(rows: LedgerRow[]): string {
  const headers = [
    "Date (Pacific)",
    "Time (Pacific)",
    "Program",
    "Season",
    "Athlete",
    "Event",
    "Method",
    "Direction",
    "Amount (USD)",
    "Platform fee (USD)",
    "Stripe ID",
    "Stripe account",
    "Recorded by",
    "Note",
  ];
  return toCsv(
    headers,
    rows.map((r) => [
      utcToLaDateInput(r.occurredAt),
      formatTime(r.occurredAt),
      r.programName ?? "",
      r.seasonName,
      r.athleteName,
      LEDGER_KIND_LABELS[r.kind],
      r.method ?? "",
      DIRECTION[r.kind],
      dollars(r.amountCents),
      r.applicationFeeCents === null ? "" : dollars(r.applicationFeeCents),
      r.stripeObjectId ?? "",
      r.stripeAccountId ?? "platform",
      r.recordedByName ?? (r.stripeObjectId ? "Stripe" : ""),
      r.note ?? "",
    ])
  );
}

/** Whole filtered ledger as CSV; audited as roster.exported / payments_ledger. */
export async function exportLedgerCsv(
  ctx: SessionContext,
  filter: LedgerFilter,
  programSlug?: string
): Promise<{ csv: string; filename: string; rowCount: number }> {
  const conds = await buildWhere(ctx, filter);
  const rows = (await selectRows(conds, EXPORT_ROW_CAP + 1)).map(toRow);
  if (rows.length > EXPORT_ROW_CAP) {
    throw new DalError("INVALID", `That range has more than ${EXPORT_ROW_CAP} events. Narrow the dates and try again.`);
  }
  await writeAudit({
    actorUserId: ctx.userId,
    action: "roster.exported",
    targetType: filter.programId ? "program" : "org_settings",
    targetId: filter.programId ?? "payments_ledger",
    metadata: {
      kind: "payments_ledger",
      format: "csv",
      programId: filter.programId ?? null,
      from: filter.from ?? null,
      to: filter.to ?? null,
      eventKind: filter.kind ?? null,
      rowCount: rows.length,
    },
  });
  const scope = filter.programId ? (programSlug ?? rows[0]?.programSlug ?? "program") : "all-programs";
  const stamp = utcToLaDateInput(new Date());
  return { csv: buildLedgerCsv(rows), filename: `payments-ledger-${scope}-${stamp}.csv`, rowCount: rows.length };
}
