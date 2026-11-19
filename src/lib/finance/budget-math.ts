import { addDays, endOfMonth, type IsoDate } from "@/lib/finance/dates";

/**
 * Budget arithmetic (pure, client-safe, unit-tested).
 *
 * Budgets hold 12 monthly amounts per (account, program) in integer cents, index 0 = the
 * fiscal year's first month. Revenue and expense amounts are both stored POSITIVE.
 *
 * Variance convention (everywhere): variance = actual - budget.
 *   - Expense: positive variance = overspent ("over budget", shown red).
 *   - Revenue: negative variance = shortfall ("under budget", shown amber).
 * Percent = variance / budget (a fraction, e.g. 0.1 = 10%); null when the budget is zero.
 */

export const MONTH_COUNT = 12;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type BudgetAcctType = "revenue" | "expense";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** First day of the month `n` months after (or before, if negative) the month containing `date`. */
export function addMonths(date: IsoDate, n: number): IsoDate {
  const [y, m] = date.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}-01`;
}

/** The 12 first-of-month dates of the fiscal year starting on `fyStart`. */
export function fiscalMonthStarts(fyStart: IsoDate): IsoDate[] {
  return Array.from({ length: MONTH_COUNT }, (_, i) => addMonths(fyStart, i));
}

/** Short column label for month `i` of the fiscal year ("Jul"). */
export function monthLabel(fyStart: IsoDate, i: number): string {
  const m = Number(addMonths(fyStart, i).slice(5, 7));
  return MONTH_ABBR[m - 1];
}

/** "Jul 2026" for month `i`. */
export function monthLabelLong(fyStart: IsoDate, i: number): string {
  const d = addMonths(fyStart, i);
  return `${MONTH_ABBR[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

export function monthBounds(fyStart: IsoDate, i: number): { from: IsoDate; to: IsoDate } {
  const from = addMonths(fyStart, i);
  return { from, to: endOfMonth(from) };
}

/** 0..11 when `date` is inside the fiscal year that starts on `fyStart`, else null. */
export function monthIndexOf(fyStart: IsoDate, date: IsoDate): number | null {
  const [fy, fm] = fyStart.split("-").map(Number);
  const [y, m] = date.split("-").map(Number);
  const idx = (y - fy) * 12 + (m - fm);
  return idx >= 0 && idx < MONTH_COUNT ? idx : null;
}

export function emptyMonths(): number[] {
  return new Array<number>(MONTH_COUNT).fill(0);
}

export function sumMonths(months: readonly number[], fromIdx = 0, toIdx = MONTH_COUNT - 1): number {
  let t = 0;
  for (let i = fromIdx; i <= toIdx; i++) t += months[i] ?? 0;
  return t;
}

/**
 * "Spread annual evenly": annual / 12 rounded down to the cent each month, with the leftover
 * cents added to the LAST month so the months always add up to exactly the annual amount.
 */
export function spreadEvenly(annualCents: number): number[] {
  if (!Number.isInteger(annualCents) || annualCents < 0) throw new RangeError("Annual amount must be whole cents, 0 or more.");
  const base = Math.floor(annualCents / MONTH_COUNT);
  const months = new Array<number>(MONTH_COUNT).fill(base);
  months[MONTH_COUNT - 1] += annualCents - base * MONTH_COUNT;
  return months;
}

export interface BudgetLineLike {
  accountId: string;
  programId: string | null;
  monthlyCents: readonly number[];
}

export interface BudgetTotals {
  revenue: number[];
  expense: number[];
  /** revenue - expense per month. */
  net: number[];
  revenueAnnual: number;
  expenseAnnual: number;
  netAnnual: number;
}

/** Monthly + annual totals of revenue, expense and net for a set of lines. */
export function budgetTotals(lines: readonly BudgetLineLike[], typeOf: (accountId: string) => BudgetAcctType | undefined): BudgetTotals {
  const revenue = emptyMonths();
  const expense = emptyMonths();
  for (const l of lines) {
    const t = typeOf(l.accountId);
    const target = t === "revenue" ? revenue : t === "expense" ? expense : null;
    if (!target) continue;
    for (let i = 0; i < MONTH_COUNT; i++) target[i] += l.monthlyCents[i] ?? 0;
  }
  const net = revenue.map((r, i) => r - expense[i]);
  const revenueAnnual = sumMonths(revenue);
  const expenseAnnual = sumMonths(expense);
  return { revenue, expense, net, revenueAnnual, expenseAnnual, netAnnual: revenueAnnual - expenseAnnual };
}

// ---- Period selection ------------------------------------------------------

export type PeriodKind = "month" | "ytd" | "year";

export interface ResolvedPeriod {
  kind: PeriodKind;
  fromIdx: number;
  toIdx: number;
  from: IsoDate;
  to: IsoDate;
  label: string;
}

/**
 * month: one month (`monthKey` "YYYY-MM", default = the month of `today`, clamped into the year).
 * ytd:   the first month through that month. year: all 12 months.
 */
export function resolvePeriod(fyStart: IsoDate, kind: PeriodKind, monthKey: string | undefined | null, today: IsoDate): ResolvedPeriod {
  let idx = monthIndexOf(fyStart, `${monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : today.slice(0, 7)}-01`);
  if (idx === null) {
    // Outside the fiscal year: a past year shows through December of it, a future year shows the first month.
    const probe = monthKey && /^\d{4}-\d{2}$/.test(monthKey) ? `${monthKey}-01` : today;
    idx = probe < fyStart ? 0 : MONTH_COUNT - 1;
  }
  if (kind === "year") {
    return {
      kind,
      fromIdx: 0,
      toIdx: MONTH_COUNT - 1,
      from: monthBounds(fyStart, 0).from,
      to: monthBounds(fyStart, MONTH_COUNT - 1).to,
      label: `Full year (${monthLabelLong(fyStart, 0)} to ${monthLabelLong(fyStart, MONTH_COUNT - 1)})`,
    };
  }
  if (kind === "ytd") {
    return {
      kind,
      fromIdx: 0,
      toIdx: idx,
      from: monthBounds(fyStart, 0).from,
      to: monthBounds(fyStart, idx).to,
      label: `Year to date (${monthLabelLong(fyStart, 0)} to ${monthLabelLong(fyStart, idx)})`,
    };
  }
  const b = monthBounds(fyStart, idx);
  return { kind: "month", fromIdx: idx, toIdx: idx, from: b.from, to: b.to, label: monthLabelLong(fyStart, idx) };
}

// ---- Variance --------------------------------------------------------------

export type VarianceStatus = "over" | "short" | "ok";

export interface Variance {
  /** actual - budget. */
  varianceCents: number;
  /** variance / budget; null when budget is 0. */
  pct: number | null;
  /** "over": expense above budget (red). "short": revenue below budget (amber). Otherwise "ok". */
  status: VarianceStatus;
}

export function varianceOf(type: BudgetAcctType, budgetCents: number, actualCents: number): Variance {
  const varianceCents = actualCents - budgetCents;
  const pct = budgetCents === 0 ? null : varianceCents / budgetCents;
  const status: VarianceStatus = type === "expense" ? (varianceCents > 0 ? "over" : "ok") : varianceCents < 0 ? "short" : "ok";
  return { varianceCents, pct, status };
}

export interface VarianceRow extends Variance {
  accountId: string;
  code: string;
  name: string;
  type: BudgetAcctType;
  programId: string | null;
  programName: string;
  budgetCents: number;
  actualCents: number;
}

export interface AccountInfoLite {
  code: string;
  name: string;
  type: BudgetAcctType;
}

export const ORG_WIDE_LABEL = "Organization-wide";

/**
 * Merge period budget amounts with actuals (both keyed by account + program). Accounts that have
 * actuals but no budget line appear with a $0 budget. Sorted revenue first, then by account code,
 * then program name.
 */
export function buildVarianceRows(
  budget: ReadonlyArray<{ accountId: string; programId: string | null; cents: number }>,
  actual: ReadonlyArray<{ accountId: string; programId: string | null; cents: number }>,
  accounts: ReadonlyMap<string, AccountInfoLite>,
  programNames: ReadonlyMap<string, string>
): VarianceRow[] {
  const key = (a: string, p: string | null) => `${a}|${p ?? ""}`;
  const merged = new Map<string, { accountId: string; programId: string | null; budget: number; actual: number }>();
  const slot = (a: string, p: string | null) => {
    const k = key(a, p);
    let s = merged.get(k);
    if (!s) merged.set(k, (s = { accountId: a, programId: p, budget: 0, actual: 0 }));
    return s;
  };
  for (const b of budget) slot(b.accountId, b.programId).budget += b.cents;
  for (const a of actual) slot(a.accountId, a.programId).actual += a.cents;

  const rows: VarianceRow[] = [];
  for (const s of merged.values()) {
    const info = accounts.get(s.accountId);
    if (!info) continue;
    if (s.budget === 0 && s.actual === 0) continue;
    rows.push({
      accountId: s.accountId,
      code: info.code,
      name: info.name,
      type: info.type,
      programId: s.programId,
      programName: s.programId ? (programNames.get(s.programId) ?? "Unknown program") : ORG_WIDE_LABEL,
      budgetCents: s.budget,
      actualCents: s.actual,
      ...varianceOf(info.type, s.budget, s.actual),
    });
  }
  rows.sort(
    (a, b) =>
      (a.type === b.type ? 0 : a.type === "revenue" ? -1 : 1) ||
      a.code.localeCompare(b.code) ||
      a.programName.localeCompare(b.programName)
  );
  return rows;
}

export interface VarianceTotals {
  revenue: Variance & { budgetCents: number; actualCents: number };
  expense: Variance & { budgetCents: number; actualCents: number };
  /** Revenue minus expense. A negative variance (net worse than budget) is "short". */
  net: Variance & { budgetCents: number; actualCents: number };
}

export function varianceTotals(rows: readonly VarianceRow[]): VarianceTotals {
  let rb = 0;
  let ra = 0;
  let eb = 0;
  let ea = 0;
  for (const r of rows) {
    if (r.type === "revenue") {
      rb += r.budgetCents;
      ra += r.actualCents;
    } else {
      eb += r.budgetCents;
      ea += r.actualCents;
    }
  }
  const nb = rb - eb;
  const na = ra - ea;
  const netVar = na - nb;
  return {
    revenue: { budgetCents: rb, actualCents: ra, ...varianceOf("revenue", rb, ra) },
    expense: { budgetCents: eb, actualCents: ea, ...varianceOf("expense", eb, ea) },
    net: {
      budgetCents: nb,
      actualCents: na,
      varianceCents: netVar,
      pct: nb === 0 ? null : netVar / Math.abs(nb),
      status: netVar < 0 ? "short" : "ok",
    },
  };
}

// ---- Seeding from actuals --------------------------------------------------

export interface MonthlyActual {
  accountId: string;
  programId: string | null;
  /** 0..11 within the PRIOR fiscal year. */
  monthIdx: number;
  /** Natural-balance cents (revenue: credits - debits; expense: debits - credits). */
  cents: number;
}

/** Round to the nearest whole dollar (cents -> cents), never below zero (refunds can make a month negative). */
export function roundToDollars(cents: number): number {
  return Math.max(0, Math.round(cents / 100) * 100);
}

/**
 * Seed budget lines from the prior fiscal year's monthly actuals, per account and program,
 * each month rounded to whole dollars. Lines that round to all zeros are dropped.
 */
export function seedLinesFromActuals(actuals: readonly MonthlyActual[]): Array<{ accountId: string; programId: string | null; monthlyCents: number[] }> {
  const byKey = new Map<string, { accountId: string; programId: string | null; monthlyCents: number[] }>();
  for (const a of actuals) {
    if (a.monthIdx < 0 || a.monthIdx >= MONTH_COUNT) continue;
    const k = `${a.accountId}|${a.programId ?? ""}`;
    let line = byKey.get(k);
    if (!line) byKey.set(k, (line = { accountId: a.accountId, programId: a.programId, monthlyCents: emptyMonths() }));
    line.monthlyCents[a.monthIdx] += a.cents;
  }
  const out = [];
  for (const line of byKey.values()) {
    line.monthlyCents = line.monthlyCents.map(roundToDollars);
    if (line.monthlyCents.some((c) => c > 0)) out.push(line);
  }
  return out;
}

/** The fiscal year one year earlier. */
export function priorYearBounds(fyStart: IsoDate): { start: IsoDate; end: IsoDate } {
  const start = addMonths(fyStart, -12);
  return { start, end: addDays(fyStart, -1) };
}
