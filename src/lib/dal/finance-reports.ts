import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { finAccounts, finFunds, finSettings, programs } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";
import {
  buildActivities,
  buildFinancialPosition,
  buildFundBalances,
  buildFunctionalExpenses,
  buildProgramSummary,
  buildRegister,
  buildTrialBalance,
  centsToDecimal,
  computeNetAssets,
  resolveAsOf,
  resolveRange,
  type AcctInfo,
  type Activities,
  type DateRange,
  type FinancialPosition,
  type FundBalances,
  type FunctionalExpenses,
  type FundInfo,
  type LineTotals,
  type NetAssets,
  type ProgramSummary,
  type RegisterResult,
  type TrialBalance,
} from "@/lib/finance/report-math";
import { addDays, fiscalYearOf, laToday, type IsoDate } from "@/lib/finance/dates";
import { DalError, type SessionContext } from "./context";
import { requireFinance, viewableProgramIds, canViewAllFinance, type FinanceAccess } from "./finance-access";
import { sumLines } from "./finance-ledger";

/**
 * Finance reports (workstream FD). Read-only. Every function authorizes with requireFinance:
 *  - "any" reports filter lines to viewableProgramIds (program-scoped users see only their programs'
 *    lines and no balance-sheet items);
 *  - balance sheet, trial balance, functional expenses and the CPA export need "view_all".
 * Totals come from sumLines (grouped by account/fund/program); each report is a handful of grouped
 * queries, never per-row lookups.
 */

export type ReportKey =
  | "activities"
  | "position"
  | "trial-balance"
  | "register"
  | "fund-balances"
  | "programs"
  | "functional-expenses"
  | "cpa-export";

export const REPORT_KEYS: ReportKey[] = [
  "activities",
  "position",
  "trial-balance",
  "register",
  "fund-balances",
  "programs",
  "functional-expenses",
  "cpa-export",
];

export interface ReportMeta {
  today: IsoDate;
  startMonth: number;
  fy: DateRange & { label: string };
  prevFy: DateRange & { label: string };
  /** Org-wide reader (may open the balance sheet, trial balance, journal links...). */
  canViewAll: boolean;
}

/** Raw query-string inputs; every report validates and defaults them. */
export interface ReportQuery {
  from?: string;
  to?: string;
  asOf?: string;
  program?: string;
  fund?: string;
  account?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Base {
  access: FinanceAccess;
  programIds: "all" | string[];
  meta: ReportMeta;
}

async function base(ctx: SessionContext, need: "any" | "view_all"): Promise<Base> {
  const access = await requireFinance(ctx, need);
  const [settings] = await db
    .select({ month: finSettings.fiscalYearStartMonth })
    .from(finSettings)
    .where(eq(finSettings.id, 1))
    .limit(1);
  const startMonth = settings?.month ?? 1;
  const today = laToday();
  const fy = fiscalYearOf(today, startMonth);
  const prevFy = fiscalYearOf(addDays(fy.start, -1), startMonth);
  return {
    access,
    programIds: viewableProgramIds(access),
    meta: {
      today,
      startMonth,
      fy: { from: fy.start, to: fy.end, label: fy.label },
      prevFy: { from: prevFy.start, to: prevFy.end, label: prevFy.label },
      canViewAll: canViewAllFinance(access),
    },
  };
}

async function loadChart(): Promise<{ accounts: AcctInfo[]; funds: FundInfo[] }> {
  const [accounts, funds] = await Promise.all([
    db
      .select({
        id: finAccounts.id,
        code: finAccounts.code,
        name: finAccounts.name,
        type: finAccounts.type,
        subtype: finAccounts.subtype,
        systemKey: finAccounts.systemKey,
      })
      .from(finAccounts),
    db
      .select({
        id: finFunds.id,
        name: finFunds.name,
        restriction: finFunds.restriction,
        programId: finFunds.programId,
      })
      .from(finFunds),
  ]);
  return { accounts, funds };
}

async function loadPrograms(): Promise<Array<{ id: string; name: string }>> {
  return db.select({ id: programs.id, name: programs.name }).from(programs).orderBy(asc(programs.name));
}

function rangeOf(meta: ReportMeta, q: ReportQuery): DateRange {
  return resolveRange(q.from, q.to, { from: meta.fy.from, to: meta.fy.to });
}

// ---------------------------------------------------------------------------
// Filter options (selects on the report pages)
// ---------------------------------------------------------------------------

export interface FilterOptions {
  programs: Array<{ id: string; name: string }>;
  funds: Array<{ id: string; name: string; restricted: boolean }>;
  /** Org-wide readers can also pick "Organization-wide (no program)". */
  allowOrgWide: boolean;
}

export async function getFilterOptions(ctx: SessionContext): Promise<FilterOptions> {
  const { programIds } = await base(ctx, "any");
  const [allPrograms, { funds }] = await Promise.all([loadPrograms(), loadChart()]);
  return {
    programs: programIds === "all" ? allPrograms : allPrograms.filter((p) => programIds.includes(p.id)),
    funds: funds
      .map((f) => ({ id: f.id, name: f.name, restricted: f.restriction === "with_donor_restrictions" }))
      .sort((a, b) => Number(a.restricted) - Number(b.restricted) || a.name.localeCompare(b.name)),
    allowOrgWide: programIds === "all",
  };
}

/** Program filter: "" all, "org" organization-wide (org-wide readers only), or a viewable program id. */
function parseProgramFilter(raw: string | undefined, programIds: "all" | string[]): string | null | undefined {
  if (!raw) return undefined;
  if (raw === "org") {
    if (programIds !== "all") throw new DalError("FORBIDDEN", "Organization-wide lines are not available to you.");
    return null;
  }
  if (!UUID_RE.test(raw)) return undefined;
  if (programIds !== "all" && !programIds.includes(raw)) throw new DalError("FORBIDDEN", "That program is not available to you.");
  return raw;
}

function parseFundFilter(raw: string | undefined): string | undefined {
  return raw && UUID_RE.test(raw) ? raw : undefined;
}

export async function getReportMeta(ctx: SessionContext): Promise<ReportMeta> {
  return (await base(ctx, "any")).meta;
}

// ---------------------------------------------------------------------------
// Statement of Activities
// ---------------------------------------------------------------------------

export interface ActivitiesNetAssets {
  beginning: NetAssets;
  ending: NetAssets;
  /** ending - beginning - change in net assets (opening balances or entries posted straight to net assets). */
  adjustments: { without: number; with: number; total: number };
}

export interface ActivitiesReport {
  meta: ReportMeta;
  range: DateRange;
  programFilter: string | null | undefined;
  fundFilter: string | undefined;
  activities: Activities;
  /** Only for org-wide readers with no program/fund filter (it is a balance-sheet item). */
  netAssets: ActivitiesNetAssets | null;
}

export async function getStatementOfActivities(ctx: SessionContext, q: ReportQuery = {}): Promise<ActivitiesReport> {
  const { programIds, meta } = await base(ctx, "any");
  const range = rangeOf(meta, q);
  const programFilter = parseProgramFilter(q.program, programIds);
  const fundFilter = parseFundFilter(q.fund);
  const [{ accounts, funds }, rawRows] = await Promise.all([
    loadChart(),
    sumLines(db, { from: range.from, to: range.to, programIds, fundId: fundFilter }),
  ]);
  const rows = programFilter === undefined ? rawRows : rawRows.filter((r) => r.programId === programFilter);
  const activities = buildActivities(accounts, funds, rows);

  let netAssets: ActivitiesNetAssets | null = null;
  if (meta.canViewAll && programFilter === undefined && !fundFilter) {
    const [beforeRows, endRows] = await Promise.all([
      sumLines(db, { to: addDays(range.from, -1) }),
      sumLines(db, { to: range.to }),
    ]);
    const beginning = computeNetAssets(accounts, funds, beforeRows);
    const ending = computeNetAssets(accounts, funds, endRows);
    netAssets = {
      beginning,
      ending,
      adjustments: {
        without: ending.without - beginning.without - activities.change.without,
        with: ending.with - beginning.with - activities.change.with,
        total: ending.total - beginning.total - activities.change.total,
      },
    };
  }
  return { meta, range, programFilter, fundFilter, activities, netAssets };
}

// ---------------------------------------------------------------------------
// Statement of Financial Position
// ---------------------------------------------------------------------------

export interface PositionReport {
  meta: ReportMeta;
  asOf: IsoDate;
  position: FinancialPosition;
}

export async function getFinancialPosition(ctx: SessionContext, q: ReportQuery = {}): Promise<PositionReport> {
  const { meta } = await base(ctx, "view_all");
  const asOf = resolveAsOf(q.asOf, meta.today);
  const [{ accounts, funds }, rows] = await Promise.all([loadChart(), sumLines(db, { to: asOf })]);
  return { meta, asOf, position: buildFinancialPosition(accounts, funds, rows) };
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

export interface TrialBalanceReport {
  meta: ReportMeta;
  asOf: IsoDate;
  trial: TrialBalance;
}

export async function getTrialBalance(ctx: SessionContext, q: ReportQuery = {}): Promise<TrialBalanceReport> {
  const { meta } = await base(ctx, "view_all");
  const asOf = resolveAsOf(q.asOf, meta.today);
  const [{ accounts }, rows] = await Promise.all([loadChart(), sumLines(db, { to: asOf })]);
  return { meta, asOf, trial: buildTrialBalance(accounts, rows) };
}

// ---------------------------------------------------------------------------
// Account register / general ledger
// ---------------------------------------------------------------------------

export const REGISTER_PAGE_LIMIT = 2000;

export interface RegisterLine {
  lineId: string;
  entryId: string;
  entryNumber: number;
  entryDate: IsoDate;
  memo: string;
  source: string;
  description: string | null;
  fundId: string;
  fundName: string;
  programId: string | null;
  programName: string | null;
  debitCents: number;
  creditCents: number;
}

export interface RegisterAccountOption {
  id: string;
  code: string;
  name: string;
  type: AcctInfo["type"];
}

export interface RegisterReport {
  meta: ReportMeta;
  range: DateRange;
  fundFilter: string | undefined;
  accounts: RegisterAccountOption[];
  account: RegisterAccountOption | null;
  register: RegisterResult<RegisterLine> | null;
  /** True when the page shows only the first REGISTER_PAGE_LIMIT lines (CSV has them all). */
  truncated: boolean;
}

interface RegisterQueryRow extends Record<string, unknown> {
  line_id: string;
  entry_id: string;
  entry_number: string | number;
  entry_date: string;
  memo: string;
  source: string;
  line_no: number;
  description: string | null;
  fund_id: string;
  fund_name: string;
  program_id: string | null;
  program_name: string | null;
  debit_cents: number;
  credit_cents: number;
}

async function queryRegisterLines(
  accountId: string,
  range: DateRange,
  programIds: "all" | string[],
  fundId: string | undefined,
  limit: number | null,
): Promise<RegisterLine[]> {
  if (programIds !== "all" && programIds.length === 0) return [];
  const conds = [
    sql`e.voided_at is null`,
    sql`l.account_id = ${accountId}::uuid`,
    sql`e.entry_date >= ${range.from}::date`,
    sql`e.entry_date <= ${range.to}::date`,
  ];
  if (fundId) conds.push(sql`l.fund_id = ${fundId}::uuid`);
  if (programIds !== "all") conds.push(sql`l.program_id in (${sql.join(programIds.map((p) => sql`${p}::uuid`), sql`, `)})`);
  const res = await db.execute<RegisterQueryRow>(sql`
    select l.id as line_id, e.id as entry_id, e.entry_number, e.entry_date::text as entry_date, e.memo, e.source::text as source,
           l.line_no, l.description, l.fund_id, f.name as fund_name, l.program_id, p.name as program_name,
           l.debit_cents, l.credit_cents
    from fin_journal_lines l
    join fin_journal_entries e on e.id = l.entry_id
    join fin_funds f on f.id = l.fund_id
    left join programs p on p.id = l.program_id
    where ${sql.join(conds, sql` and `)}
    order by e.entry_date, e.entry_number, l.line_no
    ${limit ? sql`limit ${limit}` : sql``}
  `);
  return res.rows.map((r) => ({
    lineId: r.line_id,
    entryId: r.entry_id,
    entryNumber: Number(r.entry_number),
    entryDate: r.entry_date,
    memo: r.memo,
    source: r.source,
    description: r.description,
    fundId: r.fund_id,
    fundName: r.fund_name,
    programId: r.program_id,
    programName: r.program_name,
    debitCents: r.debit_cents,
    creditCents: r.credit_cents,
  }));
}

function sumTotals(rows: LineTotals[]): { debitCents: number; creditCents: number } {
  return {
    debitCents: rows.reduce((s, r) => s + r.debitCents, 0),
    creditCents: rows.reduce((s, r) => s + r.creditCents, 0),
  };
}

async function buildRegisterReport(
  ctx: SessionContext,
  q: ReportQuery,
  limit: number | null,
): Promise<RegisterReport> {
  const { programIds, meta } = await base(ctx, "any");
  const range = rangeOf(meta, q);
  const fundFilter = parseFundFilter(q.fund);
  const { accounts } = await loadChart();
  // Program-scoped users only see revenue and expense accounts (balance-sheet accounts are org-wide).
  const options = accounts
    .filter((a) => meta.canViewAll || a.type === "revenue" || a.type === "expense")
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }));
  const account = q.account && UUID_RE.test(q.account) ? (options.find((a) => a.id === q.account) ?? null) : null;
  if (q.account && UUID_RE.test(q.account) && !account) throw new DalError("FORBIDDEN", "That account is not available to you.");
  if (!account) return { meta, range, fundFilter, accounts: options, account: null, register: null, truncated: false };

  const [opening, inRange, lines] = await Promise.all([
    sumLines(db, { to: addDays(range.from, -1), programIds, fundId: fundFilter, accountIds: [account.id] }),
    sumLines(db, { from: range.from, to: range.to, programIds, fundId: fundFilter, accountIds: [account.id] }),
    queryRegisterLines(account.id, range, programIds, fundFilter, limit === null ? null : limit + 1),
  ]);
  const truncated = limit !== null && lines.length > limit;
  const shown = truncated ? lines.slice(0, limit!) : lines;
  const register = buildRegister(account.type, sumTotals(opening), shown, sumTotals(inRange));
  return { meta, range, fundFilter, accounts: options, account, register, truncated };
}

export async function getAccountRegister(ctx: SessionContext, q: ReportQuery = {}): Promise<RegisterReport> {
  return buildRegisterReport(ctx, q, REGISTER_PAGE_LIMIT);
}

// ---------------------------------------------------------------------------
// Fund balances
// ---------------------------------------------------------------------------

export interface FundBalancesReport {
  meta: ReportMeta;
  range: DateRange;
  balances: FundBalances;
  /** Fund id -> linked program name (for the table). */
  programNames: Record<string, string>;
}

export async function getFundBalances(ctx: SessionContext, q: ReportQuery = {}): Promise<FundBalancesReport> {
  const { programIds, meta } = await base(ctx, "any");
  const range = rangeOf(meta, q);
  const [{ accounts, funds }, progs, before, during] = await Promise.all([
    loadChart(),
    loadPrograms(),
    sumLines(db, { to: addDays(range.from, -1) }),
    sumLines(db, { from: range.from, to: range.to }),
  ]);
  // Program-scoped users see only funds linked to their programs (the fund's whole balance, whatever
  // program class its lines carry).
  const visibleFunds = programIds === "all" ? funds : funds.filter((f) => f.programId && programIds.includes(f.programId));
  const balances = buildFundBalances(accounts, visibleFunds, before, during);
  const progName = new Map(progs.map((p) => [p.id, p.name]));
  const programNames: Record<string, string> = {};
  for (const f of visibleFunds) if (f.programId) programNames[f.id] = progName.get(f.programId) ?? "";
  return { meta, range, balances, programNames };
}

// ---------------------------------------------------------------------------
// Program summary
// ---------------------------------------------------------------------------

export interface ProgramSummaryReport {
  meta: ReportMeta;
  range: DateRange;
  summary: ProgramSummary;
}

export async function getProgramSummary(ctx: SessionContext, q: ReportQuery = {}): Promise<ProgramSummaryReport> {
  const { programIds, meta } = await base(ctx, "any");
  const range = rangeOf(meta, q);
  const [{ accounts }, progs, rows] = await Promise.all([
    loadChart(),
    loadPrograms(),
    sumLines(db, { from: range.from, to: range.to, programIds }),
  ]);
  return { meta, range, summary: buildProgramSummary(accounts, progs, rows) };
}

// ---------------------------------------------------------------------------
// Functional expenses
// ---------------------------------------------------------------------------

export interface FunctionalReport {
  meta: ReportMeta;
  range: DateRange;
  functional: FunctionalExpenses;
  programNames: Record<string, string>;
}

export async function getFunctionalExpenses(ctx: SessionContext, q: ReportQuery = {}): Promise<FunctionalReport> {
  const { meta } = await base(ctx, "view_all");
  const range = rangeOf(meta, q);
  const [{ accounts }, progs, rows] = await Promise.all([
    loadChart(),
    loadPrograms(),
    sumLines(db, { from: range.from, to: range.to }),
  ]);
  return {
    meta,
    range,
    functional: buildFunctionalExpenses(accounts, rows),
    programNames: Object.fromEntries(progs.map((p) => [p.id, p.name])),
  };
}

// ---------------------------------------------------------------------------
// CPA export (all non-voided journal lines)
// ---------------------------------------------------------------------------

export interface CpaPreview {
  meta: ReportMeta;
  range: DateRange;
  lineCount: number;
  entryCount: number;
  debitCents: number;
  creditCents: number;
}

export async function getCpaPreview(ctx: SessionContext, q: ReportQuery = {}): Promise<CpaPreview> {
  const { meta } = await base(ctx, "view_all");
  const range = rangeOf(meta, q);
  const res = await db.execute<{ lines: string; entries: string; debit: string; credit: string }>(sql`
    select count(*)::text as lines, count(distinct e.id)::text as entries,
           coalesce(sum(l.debit_cents), 0)::text as debit, coalesce(sum(l.credit_cents), 0)::text as credit
    from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id
    where e.voided_at is null and e.entry_date >= ${range.from}::date and e.entry_date <= ${range.to}::date
  `);
  const r = res.rows[0];
  return {
    meta,
    range,
    lineCount: Number(r.lines),
    entryCount: Number(r.entries),
    debitCents: Number(r.debit),
    creditCents: Number(r.credit),
  };
}

// ---------------------------------------------------------------------------
// CSV export (audited)
// ---------------------------------------------------------------------------

/** Money cell: written as a raw decimal (negatives keep their minus sign, which csvCell would apostrophe-guard). */
class Money {
  constructor(public cents: number) {}
}
type Cell = string | number | null | undefined | Money;

function renderCell(c: Cell): string {
  if (c instanceof Money) return centsToDecimal(c.cents);
  return csvCell(c);
}

/** UTF-8 BOM + CRLF, like src/lib/csv.ts toCsv, but with raw numeric money cells. */
function buildCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<Cell>>): string {
  const lines = [headers.map((h) => csvCell(h)).join(","), ...rows.map((r) => r.map(renderCell).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

const $ = (cents: number) => new Money(cents);

export interface CsvExport {
  csv: string;
  filename: string;
  rowCount: number;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual entry",
  opening_balance: "Opening balance",
  bank: "Bank transaction",
  transfer: "Transfer",
  registration: "Registration",
  stripe_fee: "Stripe fee",
  stripe_payout: "Stripe payout",
  platform_fee: "Platform fee",
};

export async function exportReportCsv(ctx: SessionContext, report: ReportKey, q: ReportQuery = {}): Promise<CsvExport> {
  let out: CsvExport;
  let periodLabel: string;
  switch (report) {
    case "activities": {
      const r = await getStatementOfActivities(ctx, q);
      periodLabel = `${r.range.from}_to_${r.range.to}`;
      const a = r.activities;
      const rows: Cell[][] = [];
      const section = (name: string, groups: Activities["revenueGroups"]) => {
        for (const g of groups) {
          for (const row of g.rows) rows.push([name, g.label, row.code, row.name, $(row.without), $(row.with), $(row.total)]);
          rows.push([name, g.label, "", `Total ${g.label}`, $(g.subtotal.without), $(g.subtotal.with), $(g.subtotal.total)]);
        }
      };
      section("Revenue and support", a.revenueGroups);
      rows.push(["Revenue and support", "", "", "Total revenue and support", $(a.totalRevenue.without), $(a.totalRevenue.with), $(a.totalRevenue.total)]);
      rows.push(["Releases", "", "", "Net assets released from restrictions", $(a.released.without), $(a.released.with), $(a.released.total)]);
      rows.push(["Releases", "", "", "Total revenue, support and releases", $(a.totalRevenueAndReleases.without), $(a.totalRevenueAndReleases.with), $(a.totalRevenueAndReleases.total)]);
      section("Expenses", a.expenseGroups);
      rows.push(["Expenses", "", "", "Total expenses", $(a.totalExpenses.without), $(a.totalExpenses.with), $(a.totalExpenses.total)]);
      rows.push(["Change in net assets", "", "", "Change in net assets", $(a.change.without), $(a.change.with), $(a.change.total)]);
      if (r.netAssets) {
        const n = r.netAssets;
        rows.push(["Net assets", "", "", "Net assets, beginning of period", $(n.beginning.without), $(n.beginning.with), $(n.beginning.total)]);
        rows.push(["Net assets", "", "", "Net assets, end of period", $(n.ending.without), $(n.ending.with), $(n.ending.total)]);
      }
      out = {
        csv: buildCsv(["Section", "Group", "Account code", "Account", "Without donor restrictions", "With donor restrictions", "Total"], rows),
        filename: "",
        rowCount: rows.length,
      };
      break;
    }
    case "position": {
      const r = await getFinancialPosition(ctx, q);
      periodLabel = `as-of-${r.asOf}`;
      const p = r.position;
      const rows: Cell[][] = [];
      for (const g of p.assetGroups) {
        for (const row of g.rows) rows.push(["Assets", g.label, row.code, row.name, $(row.cents)]);
      }
      rows.push(["Assets", "", "", "Total assets", $(p.totalAssets)]);
      for (const g of p.liabilityGroups) {
        for (const row of g.rows) rows.push(["Liabilities", g.label, row.code, row.name, $(row.cents)]);
      }
      rows.push(["Liabilities", "", "", "Total liabilities", $(p.totalLiabilities)]);
      rows.push(["Net assets", "", "", "Net assets without donor restrictions", $(p.netAssets.without)]);
      rows.push(["Net assets", "", "", "Net assets with donor restrictions", $(p.netAssets.with)]);
      rows.push(["Net assets", "", "", "Total net assets", $(p.netAssets.total)]);
      rows.push(["Total", "", "", "Total liabilities and net assets", $(p.totalLiabilitiesAndNetAssets)]);
      rows.push(["Check", "", "", "Difference (should be 0.00)", $(p.difference)]);
      out = { csv: buildCsv(["Section", "Group", "Account code", "Account", "Amount"], rows), filename: "", rowCount: rows.length };
      break;
    }
    case "trial-balance": {
      const r = await getTrialBalance(ctx, q);
      periodLabel = `as-of-${r.asOf}`;
      const rows: Cell[][] = r.trial.rows.map((x) => [x.code, x.name, x.type, $(x.debitCents), $(x.creditCents)]);
      rows.push(["", "Total", "", $(r.trial.totalDebits), $(r.trial.totalCredits)]);
      out = { csv: buildCsv(["Account code", "Account", "Type", "Debit", "Credit"], rows), filename: "", rowCount: r.trial.rows.length };
      break;
    }
    case "register": {
      const r = await buildRegisterReport(ctx, q, null);
      if (!r.account || !r.register) throw new DalError("NOT_FOUND", "Choose an account first.");
      periodLabel = `${r.account.code}-${r.range.from}_to_${r.range.to}`;
      const reg = r.register;
      const rows: Cell[][] = [
        [r.range.from, "", "Opening balance", "", "", "", "", "", $(reg.openingCents)],
        ...reg.rows.map((l): Cell[] => [
          l.entryDate,
          l.entryNumber,
          l.memo,
          l.description,
          l.fundName,
          l.programName ?? "",
          $(l.debitCents),
          $(l.creditCents),
          $(l.balanceCents),
        ]),
        [r.range.to, "", "Closing balance", "", "", "", $(reg.totalDebits), $(reg.totalCredits), $(reg.closingCents)],
      ];
      out = {
        csv: buildCsv(["Date", "Entry #", "Memo", "Line description", "Fund", "Program", "Debit", "Credit", "Balance"], rows),
        filename: "",
        rowCount: reg.rows.length,
      };
      break;
    }
    case "fund-balances": {
      const r = await getFundBalances(ctx, q);
      periodLabel = `${r.range.from}_to_${r.range.to}`;
      const rows: Cell[][] = r.balances.rows.map((f) => [
        f.name,
        f.restricted ? "With donor restrictions" : "Without donor restrictions",
        r.programNames[f.fundId] ?? "",
        $(f.openingCents),
        $(f.adjustmentsCents),
        $(f.revenueCents),
        $(f.expensesCents),
        $(f.closingCents),
        f.negative ? "NEGATIVE" : "",
      ]);
      out = {
        csv: buildCsv(
          ["Fund", "Restriction", "Program", "Opening balance", "Opening balances & transfers posted", "Revenue", "Expenses (released)", "Closing balance", "Flag"],
          rows,
        ),
        filename: "",
        rowCount: rows.length,
      };
      break;
    }
    case "programs": {
      const r = await getProgramSummary(ctx, q);
      periodLabel = `${r.range.from}_to_${r.range.to}`;
      const rows: Cell[][] = r.summary.rows.map((p) => [p.name, $(p.revenueCents), $(p.expensesCents), $(p.netCents)]);
      rows.push(["Total", $(r.summary.totalRevenue), $(r.summary.totalExpenses), $(r.summary.totalNet)]);
      out = { csv: buildCsv(["Program", "Revenue", "Expenses", "Surplus (deficit)"], rows), filename: "", rowCount: r.summary.rows.length };
      break;
    }
    case "functional-expenses": {
      const r = await getFunctionalExpenses(ctx, q);
      periodLabel = `${r.range.from}_to_${r.range.to}`;
      const f = r.functional;
      const rows: Cell[][] = f.rows.map((x) => [x.code, x.name, $(x.programCents), $(x.managementCents), $(x.fundraisingCents), $(x.totalCents)]);
      rows.push(["", "Total expenses", $(f.totals.programCents), $(f.totals.managementCents), $(f.totals.fundraisingCents), $(f.totals.totalCents)]);
      out = {
        csv: buildCsv(["Account code", "Account", "Program services", "Management & general", "Fundraising", "Total"], rows),
        filename: "",
        rowCount: f.rows.length,
      };
      break;
    }
    case "cpa-export": {
      const { meta } = await base(ctx, "view_all");
      const range = rangeOf(meta, q);
      periodLabel = `${range.from}_to_${range.to}`;
      const res = await db.execute<{
        entry_number: string | number;
        entry_date: string;
        memo: string;
        source: string;
        code: string;
        account_name: string;
        fund_name: string;
        program_name: string | null;
        debit_cents: number;
        credit_cents: number;
        description: string | null;
      }>(sql`
        select e.entry_number, e.entry_date::text as entry_date, e.memo, e.source::text as source,
               a.code, a.name as account_name, f.name as fund_name, p.name as program_name,
               l.debit_cents, l.credit_cents, l.description
        from fin_journal_lines l
        join fin_journal_entries e on e.id = l.entry_id
        join fin_accounts a on a.id = l.account_id
        join fin_funds f on f.id = l.fund_id
        left join programs p on p.id = l.program_id
        where e.voided_at is null and e.entry_date >= ${range.from}::date and e.entry_date <= ${range.to}::date
        order by e.entry_date, e.entry_number, l.line_no
      `);
      const rows: Cell[][] = res.rows.map((r) => [
        Number(r.entry_number),
        r.entry_date,
        r.memo,
        SOURCE_LABEL[r.source] ?? r.source,
        r.code,
        r.account_name,
        r.fund_name,
        r.program_name ?? "",
        $(r.debit_cents),
        $(r.credit_cents),
        r.description ?? "",
      ]);
      out = {
        csv: buildCsv(
          ["Entry #", "Date", "Memo", "Source", "Account code", "Account", "Fund", "Program", "Debit", "Credit", "Line description"],
          rows,
        ),
        filename: "",
        rowCount: rows.length,
      };
      break;
    }
    default:
      throw new DalError("NOT_FOUND", "Unknown report.");
  }
  out.filename = `finance-${report}-${periodLabel}.csv`;
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.report_exported",
    targetType: "fin_report",
    targetId: report,
    metadata: { report, period: periodLabel, rowCount: out.rowCount, format: "csv" },
  });
  return out;
}
