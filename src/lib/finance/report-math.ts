/**
 * Finance reports — pure math (no DB, no server-only imports; safe in client components).
 *
 * Inputs are the grouped line totals produced by `sumLines` (account x fund x program) plus
 * the chart of accounts and fund list. All amounts are integer cents.
 *
 * Presentation rules (docs/FINANCE1_PLAN.md "Accounting rules"):
 *  - Revenue lines in a restricted fund are "with donor restrictions" revenue.
 *  - Expense lines in a restricted fund are shown as expenses WITHOUT donor restrictions plus an
 *    equal "Net assets released from restrictions" reclassification (+ unrestricted, - restricted).
 *    Nothing is posted for releases; they are computed here.
 *  - Net assets without restrictions = 3000-type balance + cumulative (revenue - expense) of
 *    unrestricted funds. With restrictions = 3100 balance + cumulative restricted fund balances.
 */
import { addDays, endOfMonth, isIsoDate, type IsoDate } from "./dates";

export type AcctType = "asset" | "liability" | "net_assets" | "revenue" | "expense";

export interface AcctInfo {
  id: string;
  code: string;
  name: string;
  type: AcctType;
  subtype: string | null;
  systemKey: string | null;
}

export interface FundInfo {
  id: string;
  name: string;
  restriction: "without_donor_restrictions" | "with_donor_restrictions";
  programId: string | null;
}

export interface LineTotals {
  accountId: string;
  fundId: string;
  programId: string | null;
  debitCents: number;
  creditCents: number;
}

/** asset & expense = debits - credits; liability, net assets & revenue = credits - debits. */
export function naturalOf(type: AcctType, debitCents: number, creditCents: number): number {
  return type === "asset" || type === "expense" ? debitCents - creditCents : creditCents - debitCents;
}

function restrictedFundIds(funds: FundInfo[]): Set<string> {
  return new Set(funds.filter((f) => f.restriction === "with_donor_restrictions").map((f) => f.id));
}

function acctMap(accounts: AcctInfo[]): Map<string, AcctInfo> {
  return new Map(accounts.map((a) => [a.id, a]));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "$1,234.56"; negatives in parentheses "($1,234.56)". `dash` renders zero as an en dash. */
export function formatAmount(cents: number, opts: { dash?: boolean; symbol?: boolean } = {}): string {
  if (cents === 0 && opts.dash) return "–";
  const symbol = opts.symbol ?? true;
  const abs = Math.abs(cents);
  const s = (abs / 100).toLocaleString("en-US", {
    style: symbol ? "currency" : "decimal",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `(${s})` : s;
}

/** Integer cents -> plain decimal "-1234.56" for CSV (no float math). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

function firstOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

/** Parse ?from&to; invalid or missing values fall back to `fallback`; a reversed range is swapped. */
export function resolveRange(
  from: string | undefined | null,
  to: string | undefined | null,
  fallback: DateRange,
): DateRange {
  const f = from && isIsoDate(from) ? from : fallback.from;
  const t = to && isIsoDate(to) ? to : fallback.to;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

export function resolveAsOf(asOf: string | undefined | null, fallback: IsoDate): IsoDate {
  return asOf && isIsoDate(asOf) ? asOf : fallback;
}

export interface QuickRange extends DateRange {
  key: string;
  label: string;
}

/** Quick ranges for period reports. `fy` = fiscal-year bounds containing today; `prevFy` the one before. */
export function quickRanges(today: IsoDate, fy: DateRange, prevFy: DateRange): QuickRange[] {
  const monthStart = firstOfMonth(today);
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { key: "fy", label: "This fiscal year", from: fy.from, to: fy.to },
    { key: "last_fy", label: "Last fiscal year", from: prevFy.from, to: prevFy.to },
    { key: "month", label: "This month", from: monthStart, to: endOfMonth(today) },
    { key: "last_month", label: "Last month", from: firstOfMonth(lastMonthEnd), to: lastMonthEnd },
  ];
}

export interface QuickAsOf {
  key: string;
  label: string;
  asOf: IsoDate;
}

export function quickAsOfDates(today: IsoDate, fy: DateRange, prevFy: DateRange): QuickAsOf[] {
  return [
    { key: "today", label: "Today", asOf: today },
    { key: "last_month", label: "End of last month", asOf: addDays(firstOfMonth(today), -1) },
    { key: "fy_end", label: "End of this fiscal year", asOf: fy.to },
    { key: "last_fy", label: "End of last fiscal year", asOf: prevFy.to },
  ];
}

// ---------------------------------------------------------------------------
// Statement of Activities
// ---------------------------------------------------------------------------

export interface Cols {
  without: number;
  with: number;
  total: number;
}

const zeroCols = (): Cols => ({ without: 0, with: 0, total: 0 });
function addCols(a: Cols, b: Cols): Cols {
  return { without: a.without + b.without, with: a.with + b.with, total: a.total + b.total };
}
const mkCols = (without: number, withR: number): Cols => ({ without, with: withR, total: without + withR });

export interface ActivitiesRow extends Cols {
  accountId: string;
  code: string;
  name: string;
}

export interface ActivitiesGroup {
  label: string;
  rows: ActivitiesRow[];
  subtotal: Cols;
}

export interface Activities {
  revenueGroups: ActivitiesGroup[];
  totalRevenue: Cols;
  /** Net assets released from restrictions: + without, - with, 0 total. */
  released: Cols;
  totalRevenueAndReleases: Cols;
  expenseGroups: ActivitiesGroup[];
  totalExpenses: Cols;
  change: Cols;
}

function groupRows(rows: ActivitiesRow[], accounts: Map<string, AcctInfo>): ActivitiesGroup[] {
  const groups = new Map<string, ActivitiesRow[]>();
  for (const r of rows) {
    const label = accounts.get(r.accountId)?.subtype?.trim() || "Other";
    const list = groups.get(label) ?? [];
    list.push(r);
    groups.set(label, list);
  }
  const out: ActivitiesGroup[] = [];
  for (const [label, list] of groups) {
    list.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
    out.push({ label, rows: list, subtotal: list.reduce<Cols>((s, r) => addCols(s, r), zeroCols()) });
  }
  out.sort((a, b) => a.rows[0].code.localeCompare(b.rows[0].code, "en", { numeric: true }));
  return out;
}

export function buildActivities(accounts: AcctInfo[], funds: FundInfo[], rows: LineTotals[]): Activities {
  const am = acctMap(accounts);
  const restricted = restrictedFundIds(funds);
  const rev = new Map<string, { w: number; r: number }>();
  const exp = new Map<string, number>();
  let released = 0;
  for (const row of rows) {
    const a = am.get(row.accountId);
    if (!a) continue;
    if (a.type === "revenue") {
      const cur = rev.get(a.id) ?? { w: 0, r: 0 };
      const n = row.creditCents - row.debitCents;
      if (restricted.has(row.fundId)) cur.r += n;
      else cur.w += n;
      rev.set(a.id, cur);
    } else if (a.type === "expense") {
      const n = row.debitCents - row.creditCents;
      exp.set(a.id, (exp.get(a.id) ?? 0) + n);
      if (restricted.has(row.fundId)) released += n;
    }
  }
  const revRows: ActivitiesRow[] = [...rev].map(([id, v]) => {
    const a = am.get(id)!;
    return { accountId: id, code: a.code, name: a.name, ...mkCols(v.w, v.r) };
  });
  const expRows: ActivitiesRow[] = [...exp].map(([id, n]) => {
    const a = am.get(id)!;
    return { accountId: id, code: a.code, name: a.name, ...mkCols(n, 0) };
  });
  const revenueGroups = groupRows(revRows, am);
  const expenseGroups = groupRows(expRows, am);
  const totalRevenue = revRows.reduce<Cols>((s, r) => addCols(s, r), zeroCols());
  const totalExpenses = expRows.reduce<Cols>((s, r) => addCols(s, r), zeroCols());
  const releasedCols: Cols = { without: released, with: -released, total: 0 };
  const totalRevenueAndReleases = addCols(totalRevenue, releasedCols);
  const change: Cols = {
    without: totalRevenueAndReleases.without - totalExpenses.without,
    with: totalRevenueAndReleases.with - totalExpenses.with,
    total: totalRevenueAndReleases.total - totalExpenses.total,
  };
  return {
    revenueGroups,
    totalRevenue,
    released: releasedCols,
    totalRevenueAndReleases,
    expenseGroups,
    totalExpenses,
    change,
  };
}

// ---------------------------------------------------------------------------
// Net assets & Statement of Financial Position
// ---------------------------------------------------------------------------

export interface NetAssets {
  without: number;
  with: number;
  total: number;
  /** Balances posted straight to net-asset accounts (opening balances). */
  openingWithout: number;
  openingWith: number;
  /** Cumulative revenue - expenses for each class (releases already netted into `without`). */
  surplusWithout: number;
  surplusWith: number;
  /** Cumulative restricted-fund spending reclassified as released. */
  releasedToDate: number;
}

/**
 * Net assets from CUMULATIVE totals (everything up to the as-of date).
 * 3100 (systemKey net_assets_restricted) is restricted; every other net-asset account is unrestricted.
 */
export function computeNetAssets(accounts: AcctInfo[], funds: FundInfo[], rows: LineTotals[]): NetAssets {
  const am = acctMap(accounts);
  const restricted = restrictedFundIds(funds);
  let openingWithout = 0;
  let openingWith = 0;
  let revW = 0;
  let revR = 0;
  let expW = 0;
  let expR = 0;
  for (const row of rows) {
    const a = am.get(row.accountId);
    if (!a) continue;
    if (a.type === "net_assets") {
      const n = row.creditCents - row.debitCents;
      if (a.systemKey === "net_assets_restricted") openingWith += n;
      else openingWithout += n;
    } else if (a.type === "revenue") {
      const n = row.creditCents - row.debitCents;
      if (restricted.has(row.fundId)) revR += n;
      else revW += n;
    } else if (a.type === "expense") {
      const n = row.debitCents - row.creditCents;
      if (restricted.has(row.fundId)) expR += n;
      else expW += n;
    }
  }
  const surplusWithout = revW - expW;
  const surplusWith = revR - expR;
  const without = openingWithout + surplusWithout;
  const withR = openingWith + surplusWith;
  return {
    without,
    with: withR,
    total: without + withR,
    openingWithout,
    openingWith,
    surplusWithout,
    surplusWith,
    releasedToDate: expR,
  };
}

export interface PositionRow {
  accountId: string;
  code: string;
  name: string;
  cents: number;
}

export interface PositionGroup {
  label: string;
  rows: PositionRow[];
  subtotal: number;
}

export interface FinancialPosition {
  assetGroups: PositionGroup[];
  totalAssets: number;
  liabilityGroups: PositionGroup[];
  totalLiabilities: number;
  netAssets: NetAssets;
  totalLiabilitiesAndNetAssets: number;
  /** assets - (liabilities + net assets); anything but 0 means the books are out of balance. */
  difference: number;
  balanced: boolean;
}

function positionGroups(type: AcctType, accounts: AcctInfo[], rows: LineTotals[]): PositionGroup[] {
  const am = acctMap(accounts);
  const per = new Map<string, number>();
  for (const row of rows) {
    const a = am.get(row.accountId);
    if (!a || a.type !== type) continue;
    per.set(a.id, (per.get(a.id) ?? 0) + naturalOf(type, row.debitCents, row.creditCents));
  }
  const groups = new Map<string, PositionRow[]>();
  for (const [id, cents] of per) {
    if (cents === 0) continue; // hide zero-balance accounts on the balance sheet
    const a = am.get(id)!;
    const label = a.subtype?.trim() || "Other";
    const list = groups.get(label) ?? [];
    list.push({ accountId: id, code: a.code, name: a.name, cents });
    groups.set(label, list);
  }
  const out: PositionGroup[] = [];
  for (const [label, list] of groups) {
    list.sort((x, y) => x.code.localeCompare(y.code, "en", { numeric: true }));
    out.push({ label, rows: list, subtotal: list.reduce((s, r) => s + r.cents, 0) });
  }
  out.sort((a, b) => a.rows[0].code.localeCompare(b.rows[0].code, "en", { numeric: true }));
  return out;
}

export function buildFinancialPosition(accounts: AcctInfo[], funds: FundInfo[], rows: LineTotals[]): FinancialPosition {
  const assetGroups = positionGroups("asset", accounts, rows);
  const liabilityGroups = positionGroups("liability", accounts, rows);
  const totalAssets = assetGroups.reduce((s, g) => s + g.subtotal, 0);
  const totalLiabilities = liabilityGroups.reduce((s, g) => s + g.subtotal, 0);
  const netAssets = computeNetAssets(accounts, funds, rows);
  const totalLiabilitiesAndNetAssets = totalLiabilities + netAssets.total;
  const difference = totalAssets - totalLiabilitiesAndNetAssets;
  return {
    assetGroups,
    totalAssets,
    liabilityGroups,
    totalLiabilities,
    netAssets,
    totalLiabilitiesAndNetAssets,
    difference,
    balanced: difference === 0,
  };
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AcctType;
  debitCents: number;
  creditCents: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
}

/** Each account's net (debits - credits) shows in the debit column when positive, credit column when negative. */
export function buildTrialBalance(accounts: AcctInfo[], rows: LineTotals[]): TrialBalance {
  const am = acctMap(accounts);
  const net = new Map<string, number>();
  for (const row of rows) {
    if (!am.has(row.accountId)) continue;
    net.set(row.accountId, (net.get(row.accountId) ?? 0) + row.debitCents - row.creditCents);
  }
  const out: TrialBalanceRow[] = [];
  for (const [id, n] of net) {
    const a = am.get(id)!;
    out.push({
      accountId: id,
      code: a.code,
      name: a.name,
      type: a.type,
      debitCents: n > 0 ? n : 0,
      creditCents: n < 0 ? -n : 0,
    });
  }
  out.sort((x, y) => x.code.localeCompare(y.code, "en", { numeric: true }));
  const totalDebits = out.reduce((s, r) => s + r.debitCents, 0);
  const totalCredits = out.reduce((s, r) => s + r.creditCents, 0);
  return { rows: out, totalDebits, totalCredits, balanced: totalDebits === totalCredits };
}

// ---------------------------------------------------------------------------
// Account register
// ---------------------------------------------------------------------------

export interface RegisterResult<T> {
  openingCents: number;
  rows: Array<T & { balanceCents: number }>;
  totalDebits: number;
  totalCredits: number;
  closingCents: number;
}

/**
 * Running balance in the account's natural direction. `opening` = totals of all lines before the
 * range. `rangeTotals` (full-range sums) keeps closing correct when `lines` was truncated.
 */
export function buildRegister<T extends { debitCents: number; creditCents: number }>(
  type: AcctType,
  opening: { debitCents: number; creditCents: number },
  lines: T[],
  rangeTotals?: { debitCents: number; creditCents: number },
): RegisterResult<T> {
  const openingCents = naturalOf(type, opening.debitCents, opening.creditCents);
  let bal = openingCents;
  const rows = lines.map((l) => {
    bal += naturalOf(type, l.debitCents, l.creditCents);
    return { ...l, balanceCents: bal };
  });
  const totals = rangeTotals ?? {
    debitCents: lines.reduce((s, l) => s + l.debitCents, 0),
    creditCents: lines.reduce((s, l) => s + l.creditCents, 0),
  };
  return {
    openingCents,
    rows,
    totalDebits: totals.debitCents,
    totalCredits: totals.creditCents,
    closingCents: openingCents + naturalOf(type, totals.debitCents, totals.creditCents),
  };
}

// ---------------------------------------------------------------------------
// Fund balances
// ---------------------------------------------------------------------------

export interface FundBalanceRow {
  fundId: string;
  name: string;
  restricted: boolean;
  programId: string | null;
  openingCents: number;
  /** Net-asset lines posted in the period (e.g. opening balances). */
  adjustmentsCents: number;
  revenueCents: number;
  /** Expenses charged to the fund; for restricted funds these are the amounts "released". */
  expensesCents: number;
  closingCents: number;
  negative: boolean;
}

export interface FundBalances {
  rows: FundBalanceRow[];
  totalRestricted: number;
  totalUnrestricted: number;
  anyNegative: boolean;
}

/**
 * Fund balance = net-asset lines + revenue - expenses charged to the fund.
 * `before` = cumulative totals up to the day before the range; `during` = totals inside the range.
 * Funds with no activity, no balance and that are inactive are omitted by the caller.
 */
export function buildFundBalances(
  accounts: AcctInfo[],
  funds: FundInfo[],
  before: LineTotals[],
  during: LineTotals[],
): FundBalances {
  const am = acctMap(accounts);
  const acc = new Map<string, { open: number; adj: number; rev: number; exp: number }>();
  const slot = (id: string) => {
    let s = acc.get(id);
    if (!s) {
      s = { open: 0, adj: 0, rev: 0, exp: 0 };
      acc.set(id, s);
    }
    return s;
  };
  for (const row of before) {
    const a = am.get(row.accountId);
    if (!a) continue;
    if (a.type === "net_assets") slot(row.fundId).open += row.creditCents - row.debitCents;
    else if (a.type === "revenue") slot(row.fundId).open += row.creditCents - row.debitCents;
    else if (a.type === "expense") slot(row.fundId).open -= row.debitCents - row.creditCents;
  }
  for (const row of during) {
    const a = am.get(row.accountId);
    if (!a) continue;
    if (a.type === "net_assets") slot(row.fundId).adj += row.creditCents - row.debitCents;
    else if (a.type === "revenue") slot(row.fundId).rev += row.creditCents - row.debitCents;
    else if (a.type === "expense") slot(row.fundId).exp += row.debitCents - row.creditCents;
  }
  const rows: FundBalanceRow[] = [];
  for (const f of funds) {
    const s = acc.get(f.id);
    if (!s) continue;
    const closing = s.open + s.adj + s.rev - s.exp;
    rows.push({
      fundId: f.id,
      name: f.name,
      restricted: f.restriction === "with_donor_restrictions",
      programId: f.programId,
      openingCents: s.open,
      adjustmentsCents: s.adj,
      revenueCents: s.rev,
      expensesCents: s.exp,
      closingCents: closing,
      negative: closing < 0,
    });
  }
  // Restricted funds first, then by name.
  rows.sort((a, b) => Number(b.restricted) - Number(a.restricted) || a.name.localeCompare(b.name));
  return {
    rows,
    totalRestricted: rows.filter((r) => r.restricted).reduce((s, r) => s + r.closingCents, 0),
    totalUnrestricted: rows.filter((r) => !r.restricted).reduce((s, r) => s + r.closingCents, 0),
    anyNegative: rows.some((r) => r.negative),
  };
}

// ---------------------------------------------------------------------------
// Program summary
// ---------------------------------------------------------------------------

export interface ProgramSummaryRow {
  /** null = organization-wide (no program class). */
  programId: string | null;
  name: string;
  revenueCents: number;
  expensesCents: number;
  netCents: number;
}

export interface ProgramSummary {
  rows: ProgramSummaryRow[];
  totalRevenue: number;
  totalExpenses: number;
  totalNet: number;
}

export const ORG_WIDE_LABEL = "Organization-wide";

export function buildProgramSummary(
  accounts: AcctInfo[],
  programs: Array<{ id: string; name: string }>,
  rows: LineTotals[],
): ProgramSummary {
  const am = acctMap(accounts);
  const names = new Map(programs.map((p) => [p.id, p.name]));
  const acc = new Map<string | null, { rev: number; exp: number }>();
  for (const row of rows) {
    const a = am.get(row.accountId);
    if (!a || (a.type !== "revenue" && a.type !== "expense")) continue;
    const s = acc.get(row.programId) ?? { rev: 0, exp: 0 };
    if (a.type === "revenue") s.rev += row.creditCents - row.debitCents;
    else s.exp += row.debitCents - row.creditCents;
    acc.set(row.programId, s);
  }
  const out: ProgramSummaryRow[] = [...acc].map(([programId, s]) => ({
    programId,
    name: programId === null ? ORG_WIDE_LABEL : (names.get(programId) ?? "Unknown program"),
    revenueCents: s.rev,
    expensesCents: s.exp,
    netCents: s.rev - s.exp,
  }));
  out.sort((a, b) => {
    if (a.programId === null) return 1; // org-wide last
    if (b.programId === null) return -1;
    return a.name.localeCompare(b.name);
  });
  return {
    rows: out,
    totalRevenue: out.reduce((s, r) => s + r.revenueCents, 0),
    totalExpenses: out.reduce((s, r) => s + r.expensesCents, 0),
    totalNet: out.reduce((s, r) => s + r.netCents, 0),
  };
}

// ---------------------------------------------------------------------------
// Functional expenses (Form 990 style)
// ---------------------------------------------------------------------------

export type FunctionalClass = "program" | "management" | "fundraising";

/**
 * Expense line with a programId = Program services; otherwise an account whose subtype is
 * "Fundraising" = Fundraising; everything else = Management & general.
 */
export function functionalClassOf(subtype: string | null, programId: string | null): FunctionalClass {
  if (programId) return "program";
  if (subtype && subtype.trim().toLowerCase() === "fundraising") return "fundraising";
  return "management";
}

export interface FunctionalRow {
  accountId: string;
  code: string;
  name: string;
  programCents: number;
  managementCents: number;
  fundraisingCents: number;
  totalCents: number;
}

export interface FunctionalExpenses {
  rows: FunctionalRow[];
  totals: { programCents: number; managementCents: number; fundraisingCents: number; totalCents: number };
  /** Share of total expenses (0-100, one decimal); zeros when there are no expenses. */
  percents: { program: number; management: number; fundraising: number };
  programServicesByProgram: Array<{ programId: string; cents: number }>;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

export function buildFunctionalExpenses(accounts: AcctInfo[], rows: LineTotals[]): FunctionalExpenses {
  const am = acctMap(accounts);
  const per = new Map<string, { p: number; m: number; f: number }>();
  const byProgram = new Map<string, number>();
  for (const row of rows) {
    const a = am.get(row.accountId);
    if (!a || a.type !== "expense") continue;
    const n = row.debitCents - row.creditCents;
    const s = per.get(a.id) ?? { p: 0, m: 0, f: 0 };
    const cls = functionalClassOf(a.subtype, row.programId);
    if (cls === "program") {
      s.p += n;
      byProgram.set(row.programId!, (byProgram.get(row.programId!) ?? 0) + n);
    } else if (cls === "fundraising") s.f += n;
    else s.m += n;
    per.set(a.id, s);
  }
  const out: FunctionalRow[] = [...per].map(([id, s]) => {
    const a = am.get(id)!;
    return {
      accountId: id,
      code: a.code,
      name: a.name,
      programCents: s.p,
      managementCents: s.m,
      fundraisingCents: s.f,
      totalCents: s.p + s.m + s.f,
    };
  });
  out.sort((x, y) => x.code.localeCompare(y.code, "en", { numeric: true }));
  const totals = {
    programCents: out.reduce((s, r) => s + r.programCents, 0),
    managementCents: out.reduce((s, r) => s + r.managementCents, 0),
    fundraisingCents: out.reduce((s, r) => s + r.fundraisingCents, 0),
    totalCents: out.reduce((s, r) => s + r.totalCents, 0),
  };
  return {
    rows: out,
    totals,
    percents: {
      program: pct(totals.programCents, totals.totalCents),
      management: pct(totals.managementCents, totals.totalCents),
      fundraising: pct(totals.fundraisingCents, totals.totalCents),
    },
    programServicesByProgram: [...byProgram].map(([programId, cents]) => ({ programId, cents })),
  };
}
