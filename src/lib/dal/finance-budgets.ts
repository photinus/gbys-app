import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx, type DbTx } from "@/db";
import { finAccounts, finBudgetLines, finBudgets, finSettings, programs, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";
import { fiscalYearOf, laToday, type IsoDate } from "@/lib/finance/dates";
import {
  MONTH_COUNT,
  buildVarianceRows,
  budgetTotals,
  monthLabelLong,
  priorYearBounds,
  resolvePeriod,
  seedLinesFromActuals,
  sumMonths,
  varianceTotals,
  monthBounds,
  fiscalMonthStarts,
  type BudgetAcctType,
  type BudgetTotals,
  type MonthlyActual,
  type PeriodKind,
  type ResolvedPeriod,
  type VarianceRow,
  type VarianceTotals,
} from "@/lib/finance/budget-math";
import { centsToDecimal } from "@/lib/finance/report-math";
import { createBudgetSchema, saveBudgetSchema, unadoptSchema, type CreateBudgetInput, type SaveBudgetInput } from "@/lib/validation/finance-budgets";
import { DalError, type SessionContext } from "./context";
import { requireFinance, viewableProgramIds } from "./finance-access";
import { listProgramOptions, type ProgramOption } from "./finance-accounts";
import { sumLines } from "./finance-ledger";

/**
 * Finance 2, RB: budgets and budget vs. actual.
 *
 * Access: `any` reads (program-scoped users see only adopted budgets, and only the lines of
 * their programs), `edit` creates / edits / deletes drafts, `admin` adopts / un-adopts. An adopted
 * budget is read-only. At most one budget per fiscal year can be adopted.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", "Budget not found.");
}

async function fiscalStartMonth(tx: DbOrTx = db): Promise<number> {
  const [s] = await tx.select({ m: finSettings.fiscalYearStartMonth }).from(finSettings).where(eq(finSettings.id, 1)).limit(1);
  return s?.m ?? 1;
}

interface AcctRow {
  id: string;
  code: string;
  name: string;
  type: string;
}

async function loadAccounts(tx: DbOrTx = db): Promise<Map<string, AcctRow>> {
  const rows = await tx.select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, type: finAccounts.type }).from(finAccounts);
  return new Map(rows.map((r) => [r.id, r]));
}

function budgetType(a: AcctRow | undefined): BudgetAcctType | undefined {
  return a?.type === "revenue" ? "revenue" : a?.type === "expense" ? "expense" : undefined;
}

// ---- Reads -------------------------------------------------------------------------

export type BudgetStatus = "draft" | "adopted";

export interface BudgetListRow {
  id: string;
  name: string;
  fiscalYearStart: IsoDate;
  fiscalYearEnd: IsoDate;
  fyLabel: string;
  status: BudgetStatus;
  adoptedAt: Date | null;
  revenueCents: number;
  expenseCents: number;
  netCents: number;
  lineCount: number;
  updatedAt: Date;
}

export interface BudgetListResult {
  budgets: BudgetListRow[];
  canEdit: boolean;
  canAdopt: boolean;
  /** True for program-scoped users (drafts hidden, totals limited to their programs). */
  scoped: boolean;
}

export async function listBudgets(ctx: SessionContext): Promise<BudgetListResult> {
  const access = await requireFinance(ctx, "any");
  const programIds = viewableProgramIds(access);
  const scoped = programIds !== "all";
  const startMonth = await fiscalStartMonth();
  const [rows, lines, accts] = await Promise.all([
    db
      .select()
      .from(finBudgets)
      .where(scoped ? eq(finBudgets.status, "adopted") : undefined)
      .orderBy(desc(finBudgets.fiscalYearStart), asc(finBudgets.name)),
    db.select({ budgetId: finBudgetLines.budgetId, accountId: finBudgetLines.accountId, programId: finBudgetLines.programId, monthlyCents: finBudgetLines.monthlyCents }).from(finBudgetLines),
    loadAccounts(),
  ]);
  const byBudget = new Map<string, typeof lines>();
  for (const l of lines) {
    if (scoped && (l.programId === null || !programIds.includes(l.programId))) continue;
    byBudget.set(l.budgetId, [...(byBudget.get(l.budgetId) ?? []), l]);
  }
  return {
    scoped,
    canEdit: access.level === "admin" || access.level === "editor",
    canAdopt: access.level === "admin",
    budgets: rows.map((b) => {
      const ls = byBudget.get(b.id) ?? [];
      const t = budgetTotals(ls, (id) => budgetType(accts.get(id)));
      return {
        id: b.id,
        name: b.name,
        fiscalYearStart: b.fiscalYearStart,
        fiscalYearEnd: b.fiscalYearEnd,
        fyLabel: fiscalYearOf(b.fiscalYearStart, startMonth).label,
        status: b.status,
        adoptedAt: b.adoptedAt,
        revenueCents: t.revenueAnnual,
        expenseCents: t.expenseAnnual,
        netCents: t.netAnnual,
        lineCount: ls.length,
        updatedAt: b.updatedAt,
      };
    }),
  };
}

export interface BudgetLineDetail {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: BudgetAcctType;
  programId: string | null;
  programName: string | null;
  monthlyCents: number[];
  note: string | null;
}

export interface BudgetDetail {
  id: string;
  name: string;
  notes: string | null;
  fiscalYearStart: IsoDate;
  fiscalYearEnd: IsoDate;
  fyLabel: string;
  status: BudgetStatus;
  adoptedAt: Date | null;
  adoptedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Column labels for the 12 months ("Jul 2026"). */
  monthLabels: string[];
  lines: BudgetLineDetail[];
  totals: BudgetTotals;
  /** Draft and the viewer can edit. */
  canEdit: boolean;
  /** Org-wide admin: may adopt / un-adopt. */
  canAdopt: boolean;
  /** Program-scoped viewer: only their programs' lines are included. */
  scoped: boolean;
}

export async function getBudget(ctx: SessionContext, id: string): Promise<BudgetDetail> {
  const access = await requireFinance(ctx, "any");
  assertUuid(id);
  const programIds = viewableProgramIds(access);
  const scoped = programIds !== "all";
  const [b] = await db
    .select({ b: finBudgets, adoptedByName: users.name })
    .from(finBudgets)
    .leftJoin(users, eq(users.id, finBudgets.adoptedByUserId))
    .where(eq(finBudgets.id, id))
    .limit(1);
  if (!b || (scoped && b.b.status !== "adopted")) throw new DalError("NOT_FOUND", "Budget not found.");
  const startMonth = await fiscalStartMonth();
  const rows = await db
    .select({
      accountId: finBudgetLines.accountId,
      accountCode: finAccounts.code,
      accountName: finAccounts.name,
      accountType: finAccounts.type,
      programId: finBudgetLines.programId,
      programName: programs.name,
      monthlyCents: finBudgetLines.monthlyCents,
      note: finBudgetLines.note,
    })
    .from(finBudgetLines)
    .innerJoin(finAccounts, eq(finAccounts.id, finBudgetLines.accountId))
    .leftJoin(programs, eq(programs.id, finBudgetLines.programId))
    .where(eq(finBudgetLines.budgetId, id));
  const lines: BudgetLineDetail[] = rows
    .filter((r) => !scoped || (r.programId !== null && programIds.includes(r.programId)))
    .map((r) => ({ ...r, accountType: r.accountType === "revenue" ? ("revenue" as const) : ("expense" as const) }))
    .sort(
      (a, c) =>
        (a.accountType === c.accountType ? 0 : a.accountType === "revenue" ? -1 : 1) ||
        a.accountCode.localeCompare(c.accountCode) ||
        (a.programName ?? "").localeCompare(c.programName ?? "")
    );
  const canEditBooks = access.level === "admin" || access.level === "editor";
  return {
    id: b.b.id,
    name: b.b.name,
    notes: b.b.notes,
    fiscalYearStart: b.b.fiscalYearStart,
    fiscalYearEnd: b.b.fiscalYearEnd,
    fyLabel: fiscalYearOf(b.b.fiscalYearStart, startMonth).label,
    status: b.b.status,
    adoptedAt: b.b.adoptedAt,
    adoptedByName: b.adoptedByName,
    createdAt: b.b.createdAt,
    updatedAt: b.b.updatedAt,
    monthLabels: Array.from({ length: MONTH_COUNT }, (_, i) => monthLabelLong(b.b.fiscalYearStart, i)),
    lines,
    totals: budgetTotals(lines, (aid) => (lines.find((l) => l.accountId === aid)?.accountType)),
    canEdit: canEditBooks && b.b.status === "draft",
    canAdopt: access.level === "admin",
    scoped,
  };
}

export interface BudgetEditorOptions {
  accounts: { id: string; code: string; name: string; type: BudgetAcctType }[];
  programs: ProgramOption[];
}

/** Active revenue and expense accounts plus programs, for the grid editor ("edit"). */
export async function getBudgetEditorOptions(ctx: SessionContext): Promise<BudgetEditorOptions> {
  await requireFinance(ctx, "edit");
  const [accts, progs] = await Promise.all([
    db
      .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, type: finAccounts.type })
      .from(finAccounts)
      .where(and(eq(finAccounts.isActive, true), inArray(finAccounts.type, ["revenue", "expense"])))
      .orderBy(asc(finAccounts.code)),
    listProgramOptions(),
  ]);
  return {
    accounts: accts.map((a) => ({ ...a, type: a.type === "revenue" ? ("revenue" as const) : ("expense" as const) })),
    programs: progs,
  };
}

export interface CreateBudgetFormData {
  /** Default fiscal year (the current one) as a start date, plus next year's. */
  fiscalYears: { start: IsoDate; label: string }[];
  budgets: { id: string; name: string; fyLabel: string; status: BudgetStatus }[];
}

export async function getCreateBudgetFormData(ctx: SessionContext): Promise<CreateBudgetFormData> {
  await requireFinance(ctx, "edit");
  const startMonth = await fiscalStartMonth();
  const today = laToday();
  const cur = fiscalYearOf(today, startMonth);
  const next = fiscalYearOf(addDay(cur.end), startMonth);
  const prev = fiscalYearOf(addDay(cur.start, -1), startMonth);
  const list = await listBudgets(ctx);
  return {
    fiscalYears: [next, cur, prev].map((f) => ({ start: f.start, label: f.label })),
    budgets: list.budgets.map((b) => ({ id: b.id, name: b.name, fyLabel: b.fyLabel, status: b.status })),
  };
}

function addDay(date: IsoDate, n = 1): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// ---- Create -------------------------------------------------------------------------

type NewLine = { accountId: string; programId: string | null; monthlyCents: number[]; note?: string | null };

async function actualsByMonth(tx: DbOrTx, fyStart: IsoDate, accts: Map<string, AcctRow>): Promise<MonthlyActual[]> {
  const prior = priorYearBounds(fyStart);
  const out: MonthlyActual[] = [];
  for (let i = 0; i < MONTH_COUNT; i++) {
    const { from, to } = monthBounds(prior.start, i);
    const rows = await sumLines(tx, { from, to });
    const agg = new Map<string, MonthlyActual>();
    for (const r of rows) {
      const t = budgetType(accts.get(r.accountId));
      if (!t) continue;
      const cents = t === "revenue" ? r.creditCents - r.debitCents : r.debitCents - r.creditCents;
      const k = `${r.accountId}|${r.programId ?? ""}`;
      const cur = agg.get(k);
      if (cur) cur.cents += cents;
      else agg.set(k, { accountId: r.accountId, programId: r.programId, monthIdx: i, cents });
    }
    out.push(...agg.values());
  }
  return out;
}

/** Create a draft budget for a fiscal year: blank, copied from another budget, or seeded from the prior year's actuals. */
export async function createBudget(ctx: SessionContext, input: CreateBudgetInput): Promise<{ id: string; lineCount: number }> {
  await requireFinance(ctx, "edit");
  const data = createBudgetSchema.parse(input);
  const startMonth = await fiscalStartMonth();
  const fy = fiscalYearOf(data.fiscalYearDate, startMonth);
  return db.transaction(async (tx) => {
    let lines: NewLine[] = [];
    if (data.source === "copy") {
      assertUuid(data.copyFromBudgetId!);
      const [src] = await tx.select({ id: finBudgets.id }).from(finBudgets).where(eq(finBudgets.id, data.copyFromBudgetId!)).limit(1);
      if (!src) throw new DalError("INVALID", "The budget to copy no longer exists.");
      const rows = await tx.select().from(finBudgetLines).where(eq(finBudgetLines.budgetId, src.id));
      lines = rows.map((r) => ({ accountId: r.accountId, programId: r.programId, monthlyCents: [...r.monthlyCents], note: r.note }));
    } else if (data.source === "actuals") {
      const accts = await loadAccounts(tx);
      lines = seedLinesFromActuals(await actualsByMonth(tx, fy.start, accts));
    }
    const [b] = await tx
      .insert(finBudgets)
      .values({ name: data.name, fiscalYearStart: fy.start, fiscalYearEnd: fy.end, notes: data.notes, createdByUserId: ctx.userId })
      .returning({ id: finBudgets.id });
    if (lines.length) {
      await tx.insert(finBudgetLines).values(
        lines.map((l) => ({ budgetId: b.id, accountId: l.accountId, programId: l.programId, monthlyCents: l.monthlyCents, note: l.note ?? null }))
      );
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.budget_created",
        targetType: "fin_budget",
        targetId: b.id,
        metadata: { name: data.name, fiscalYearStart: fy.start, source: data.source, copyFrom: data.copyFromBudgetId, lineCount: lines.length },
      },
      tx
    );
    return { id: b.id, lineCount: lines.length };
  });
}

// ---- Save / delete ----------------------------------------------------------------------

async function lockBudget(tx: DbTx, id: string) {
  assertUuid(id);
  const [b] = await tx.select().from(finBudgets).where(eq(finBudgets.id, id)).for("update").limit(1);
  if (!b) throw new DalError("NOT_FOUND", "Budget not found.");
  return b;
}

const ADOPTED_MSG = "This budget has been adopted and is read-only. A finance admin can un-adopt it (with a reason) to make changes.";

/** Replace a draft budget's name, notes and all lines. Refused once adopted. */
export async function saveBudget(ctx: SessionContext, input: SaveBudgetInput): Promise<{ lineCount: number }> {
  await requireFinance(ctx, "edit");
  const data = saveBudgetSchema.parse(input);
  const keys = new Set<string>();
  for (const l of data.lines) {
    const k = `${l.accountId}|${l.programId ?? ""}`;
    if (keys.has(k)) throw new DalError("INVALID", "Each account can only appear once per program. Merge the duplicate rows.");
    keys.add(k);
    if (l.monthlyCents.reduce((s, c) => s + c, 0) > 2_000_000_000) throw new DalError("INVALID", "A budget line total is too large.");
  }
  return db.transaction(async (tx) => {
    const b = await lockBudget(tx, data.id);
    if (b.status === "adopted") throw new DalError("INVALID", ADOPTED_MSG);
    const accts = await loadAccounts(tx);
    for (const l of data.lines) {
      if (!budgetType(accts.get(l.accountId))) throw new DalError("INVALID", "Budget lines must use revenue or expense accounts.");
    }
    const progIds = [...new Set(data.lines.map((l) => l.programId).filter((p): p is string => !!p))];
    if (progIds.length) {
      const found = await tx.select({ id: programs.id }).from(programs).where(and(inArray(programs.id, progIds), isNull(programs.deletedAt)));
      if (found.length !== progIds.length) throw new DalError("INVALID", "Unknown program on a budget line.");
    }
    await tx.delete(finBudgetLines).where(eq(finBudgetLines.budgetId, b.id));
    if (data.lines.length) {
      await tx.insert(finBudgetLines).values(
        data.lines.map((l) => ({ budgetId: b.id, accountId: l.accountId, programId: l.programId, monthlyCents: l.monthlyCents, note: l.note }))
      );
    }
    await tx.update(finBudgets).set({ name: data.name, notes: data.notes }).where(eq(finBudgets.id, b.id));
    const t = budgetTotals(data.lines, (id) => budgetType(accts.get(id)));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.budget_updated",
        targetType: "fin_budget",
        targetId: b.id,
        metadata: { name: data.name, lineCount: data.lines.length, revenueCents: t.revenueAnnual, expenseCents: t.expenseAnnual },
      },
      tx
    );
    return { lineCount: data.lines.length };
  });
}

/** Delete a draft budget and its lines (adopted budgets can't be deleted). */
export async function deleteDraftBudget(ctx: SessionContext, id: string): Promise<void> {
  await requireFinance(ctx, "edit");
  await db.transaction(async (tx) => {
    const b = await lockBudget(tx, id);
    if (b.status === "adopted") throw new DalError("INVALID", ADOPTED_MSG);
    await tx.delete(finBudgetLines).where(eq(finBudgetLines.budgetId, b.id));
    await tx.delete(finBudgets).where(eq(finBudgets.id, b.id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.budget_updated", targetType: "fin_budget", targetId: b.id, metadata: { deleted: true, name: b.name } },
      tx
    );
  });
}

// ---- Adopt / un-adopt ---------------------------------------------------------------------

/** Adopt a draft (finance admin). Only one budget per fiscal year may be adopted. */
export async function adoptBudget(ctx: SessionContext, id: string): Promise<void> {
  await requireFinance(ctx, "admin");
  await db.transaction(async (tx) => {
    const b = await lockBudget(tx, id);
    // Serialize concurrent adoptions for the same fiscal year.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fin:budget_adopt:${b.fiscalYearStart}`}))`);
    if (b.status === "adopted") throw new DalError("INVALID", "This budget is already adopted.");
    const [other] = await tx
      .select({ id: finBudgets.id, name: finBudgets.name })
      .from(finBudgets)
      .where(and(eq(finBudgets.fiscalYearStart, b.fiscalYearStart), eq(finBudgets.status, "adopted")))
      .limit(1);
    if (other) {
      throw new DalError("INVALID", `“${other.name}” is already adopted for this fiscal year. Un-adopt it first (only one budget can be adopted per year).`);
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(finBudgetLines).where(eq(finBudgetLines.budgetId, b.id));
    if (n === 0) throw new DalError("INVALID", "Add some budget amounts before adopting.");
    await tx.update(finBudgets).set({ status: "adopted", adoptedAt: new Date(), adoptedByUserId: ctx.userId }).where(eq(finBudgets.id, b.id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.budget_adopted", targetType: "fin_budget", targetId: b.id, metadata: { name: b.name, fiscalYearStart: b.fiscalYearStart } },
      tx
    );
  });
}

/** Return an adopted budget to draft so it can be edited (finance admin; reason required, audited). */
export async function unadoptBudget(ctx: SessionContext, input: { id: string; reason: string }): Promise<void> {
  await requireFinance(ctx, "admin");
  const data = unadoptSchema.parse(input);
  await db.transaction(async (tx) => {
    const b = await lockBudget(tx, data.id);
    if (b.status !== "adopted") throw new DalError("INVALID", "This budget isn't adopted.");
    await tx.update(finBudgets).set({ status: "draft", adoptedAt: null, adoptedByUserId: null }).where(eq(finBudgets.id, b.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.budget_updated",
        targetType: "fin_budget",
        targetId: b.id,
        metadata: { unadopted: true, reason: data.reason, name: b.name, previouslyAdoptedAt: b.adoptedAt?.toISOString() ?? null },
      },
      tx
    );
  });
}

// ---- Budget vs. actual ----------------------------------------------------------------------

export interface BudgetVsActualQuery {
  budgetId?: string | null;
  period?: string | null;
  /** "YYYY-MM": the month for "month", or the last month of "year to date". */
  month?: string | null;
}

export interface BudgetOption {
  id: string;
  name: string;
  fyLabel: string;
  fiscalYearStart: IsoDate;
  status: BudgetStatus;
}

export interface BudgetVsActualReport {
  budgets: BudgetOption[];
  budget: (BudgetOption & { fiscalYearEnd: IsoDate }) | null;
  period: ResolvedPeriod | null;
  /** Months of the budget's fiscal year for the month picker ("2026-07" -> "Jul 2026"). */
  monthOptions: { key: string; label: string }[];
  rows: VarianceRow[];
  totals: VarianceTotals | null;
  /** Program-scoped viewer: rows limited to their programs. */
  scoped: boolean;
}

const PERIODS: PeriodKind[] = ["month", "ytd", "year"];

export async function getBudgetVsActual(ctx: SessionContext, q: BudgetVsActualQuery = {}): Promise<BudgetVsActualReport> {
  const access = await requireFinance(ctx, "any");
  const programIds = viewableProgramIds(access);
  const scoped = programIds !== "all";
  const startMonth = await fiscalStartMonth();
  const today = laToday();

  const all = await db
    .select()
    .from(finBudgets)
    .where(scoped ? eq(finBudgets.status, "adopted") : undefined)
    .orderBy(desc(finBudgets.fiscalYearStart), asc(finBudgets.name));
  const budgets: BudgetOption[] = all.map((b) => ({
    id: b.id,
    name: b.name,
    fyLabel: fiscalYearOf(b.fiscalYearStart, startMonth).label,
    fiscalYearStart: b.fiscalYearStart,
    status: b.status,
  }));
  const empty = { budgets, budget: null, period: null, monthOptions: [], rows: [], totals: null, scoped } as BudgetVsActualReport;
  if (all.length === 0) return empty;

  // Default: the adopted budget of the current fiscal year, else any adopted one, else the newest budget.
  const curStart = fiscalYearOf(today, startMonth).start;
  const chosen =
    (q.budgetId && all.find((b) => b.id === q.budgetId)) ||
    all.find((b) => b.status === "adopted" && b.fiscalYearStart === curStart) ||
    all.find((b) => b.status === "adopted") ||
    all[0];

  const kind: PeriodKind = PERIODS.includes(q.period as PeriodKind) ? (q.period as PeriodKind) : "ytd";
  const period = resolvePeriod(chosen.fiscalYearStart, kind, q.month, today);
  const accts = await loadAccounts();

  const [lineRows, actualRows, progs] = await Promise.all([
    db.select().from(finBudgetLines).where(eq(finBudgetLines.budgetId, chosen.id)),
    sumLines(db, { from: period.from, to: period.to, programIds }),
    db.select({ id: programs.id, name: programs.name }).from(programs),
  ]);
  const budget = lineRows
    .filter((l) => !scoped || (l.programId !== null && programIds.includes(l.programId)))
    .map((l) => ({ accountId: l.accountId, programId: l.programId, cents: sumMonths(l.monthlyCents, period.fromIdx, period.toIdx) }));
  const actualMap = new Map<string, { accountId: string; programId: string | null; cents: number }>();
  for (const r of actualRows) {
    const t = budgetType(accts.get(r.accountId));
    if (!t) continue;
    const cents = t === "revenue" ? r.creditCents - r.debitCents : r.debitCents - r.creditCents;
    const k = `${r.accountId}|${r.programId ?? ""}`;
    const cur = actualMap.get(k);
    if (cur) cur.cents += cents;
    else actualMap.set(k, { accountId: r.accountId, programId: r.programId, cents });
  }
  const accountInfo = new Map<string, { code: string; name: string; type: BudgetAcctType }>();
  for (const [id, a] of accts) {
    const t = budgetType(a);
    if (t) accountInfo.set(id, { code: a.code, name: a.name, type: t });
  }
  const rows = buildVarianceRows(budget, [...actualMap.values()], accountInfo, new Map(progs.map((p) => [p.id, p.name])));
  const fy = fiscalMonthStarts(chosen.fiscalYearStart);
  return {
    budgets,
    budget: {
      id: chosen.id,
      name: chosen.name,
      fyLabel: fiscalYearOf(chosen.fiscalYearStart, startMonth).label,
      fiscalYearStart: chosen.fiscalYearStart,
      fiscalYearEnd: chosen.fiscalYearEnd,
      status: chosen.status,
    },
    period,
    monthOptions: fy.map((d, i) => ({ key: d.slice(0, 7), label: monthLabelLong(chosen.fiscalYearStart, i) })),
    rows,
    totals: varianceTotals(rows),
    scoped,
  };
}

/** CSV of the budget vs. actual report (same filters as the page; audited). */
export async function exportBudgetVsActualCsv(
  ctx: SessionContext,
  q: BudgetVsActualQuery = {}
): Promise<{ csv: string; filename: string; rowCount: number }> {
  const r = await getBudgetVsActual(ctx, q);
  if (!r.budget || !r.period || !r.totals) throw new DalError("NOT_FOUND", "There is no budget to report on yet.");
  const money = (c: number) => centsToDecimal(c);
  const pct = (p: number | null) => (p === null ? "" : (p * 100).toFixed(1));
  const flag = (s: string) => (s === "over" ? "Over budget" : s === "short" ? "Under budget" : "");
  const head = ["Type", "Account code", "Account", "Program", "Budget", "Actual", "Variance (actual - budget)", "Variance %", "Flag"];
  const lines = [head.map((h) => csvCell(h)).join(",")];
  for (const row of r.rows) {
    lines.push(
      [
        csvCell(row.type === "revenue" ? "Revenue" : "Expense"),
        csvCell(row.code),
        csvCell(row.name),
        csvCell(row.programName),
        money(row.budgetCents),
        money(row.actualCents),
        money(row.varianceCents),
        pct(row.pct),
        csvCell(flag(row.status)),
      ].join(",")
    );
  }
  const tot = (label: string, t: VarianceTotals["revenue"]) =>
    ["Total", "", csvCell(label), "", money(t.budgetCents), money(t.actualCents), money(t.varianceCents), pct(t.pct), csvCell(flag(t.status))].join(",");
  lines.push(tot("Total revenue", r.totals.revenue));
  lines.push(tot("Total expenses", r.totals.expense));
  lines.push(tot("Net (revenue minus expenses)", r.totals.net));
  const filename = `finance-budget-vs-actual-${r.period.from}_to_${r.period.to}.csv`;
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.report_exported",
    targetType: "fin_report",
    targetId: "budget",
    metadata: { report: "budget", period: `${r.period.from}_to_${r.period.to}`, budgetId: r.budget.id, rowCount: r.rows.length, format: "csv" },
  });
  return { csv: "﻿" + lines.join("\r\n") + "\r\n", filename, rowCount: r.rows.length };
}
