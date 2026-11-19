import "server-only";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  finAccounts,
  finBankAccounts,
  finBankTransactions,
  finFunds,
  finJournalEntries,
  finSettings,
  finSimplefinConnections,
  programs,
} from "@/db/schema";
import { isEncryptionConfigured } from "@/lib/crypto";
import { fiscalYearOf, laToday } from "@/lib/finance/dates";
import type { RestrictionValue } from "@/lib/validation/finance-gl";
import type { SessionContext } from "./context";
import { canViewAllFinance, requireFinance, viewableProgramIds, type FinanceLevel } from "./finance-access";
import { listFunds } from "./finance-accounts";
import { naturalBalance, sumLines, type FinAccountType } from "./finance-ledger";

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  /** What to do, in plain words. */
  hint: string;
  /** Page that fixes it (null when it's a server setup task). */
  href: string | null;
}

export interface BankBalanceRow {
  id: string;
  code: string;
  name: string;
  type: FinAccountType;
  /** Balance according to our books. */
  bookCents: number;
  /** Linked bank feeds (balance as the bank reports it). */
  feeds: { name: string; balanceCents: number | null; asOf: Date | null; lastSyncAt: Date | null }[];
}

export interface OrgOverview {
  kind: "org";
  level: FinanceLevel;
  fiscalYear: { start: string; end: string; label: string };
  banks: BankBalanceRow[];
  stripeBalanceCents: number;
  undepositedCents: number;
  funds: {
    id: string;
    name: string;
    restriction: RestrictionValue;
    programName: string | null;
    balanceCents: number;
    isNegative: boolean;
  }[];
  revenueCents: number;
  expenseCents: number;
  needsReviewCount: number;
  lockDate: string | null;
  checklist: ChecklistItem[];
}

export interface ProgramOverview {
  kind: "program";
  fiscalYear: { start: string; end: string; label: string };
  programs: { id: string; name: string; revenueCents: number; expenseCents: number }[];
  funds: { id: string; name: string; programName: string | null; balanceCents: number; isNegative: boolean }[];
}

export type FinanceOverview = OrgOverview | ProgramOverview;

export async function getFinanceOverview(ctx: SessionContext): Promise<FinanceOverview> {
  const access = await requireFinance(ctx, "any");
  const [settings] = await db.select().from(finSettings).where(eq(finSettings.id, 1)).limit(1);
  const fy = fiscalYearOf(laToday(), settings?.fiscalYearStartMonth ?? 1);
  const accts = await db.select().from(finAccounts);
  const typeOf = new Map(accts.map((a) => [a.id, a.type]));

  if (!canViewAllFinance(access)) {
    const ids = viewableProgramIds(access);
    const programIds = ids === "all" ? [] : ids;
    const [progRows, totals, funds] = await Promise.all([
      programIds.length
        ? db.select({ id: programs.id, name: programs.name }).from(programs).where(inArray(programs.id, programIds)).orderBy(asc(programs.name))
        : Promise.resolve([]),
      sumLines(db, { from: fy.start, to: fy.end, programIds }),
      programIds.length
        ? db
            .select({ id: finFunds.id, name: finFunds.name, programName: programs.name })
            .from(finFunds)
            .innerJoin(programs, eq(programs.id, finFunds.programId))
            .where(
              and(
                inArray(finFunds.programId, programIds),
                eq(finFunds.restriction, "with_donor_restrictions"),
                eq(finFunds.isActive, true)
              )
            )
            .orderBy(asc(finFunds.name))
        : Promise.resolve([]),
    ]);
    const perProgram = new Map<string, { rev: number; exp: number }>();
    for (const t of totals) {
      if (!t.programId) continue;
      const type = typeOf.get(t.accountId);
      const cur = perProgram.get(t.programId) ?? { rev: 0, exp: 0 };
      if (type === "revenue") cur.rev += t.creditCents - t.debitCents;
      if (type === "expense") cur.exp += t.debitCents - t.creditCents;
      perProgram.set(t.programId, cur);
    }
    const fundRows = await Promise.all(
      funds.map(async (f) => {
        let bal = 0;
        for (const t of await sumLines(db, { fundId: f.id })) {
          const type = typeOf.get(t.accountId);
          if (type === "revenue" || type === "net_assets") bal += t.creditCents - t.debitCents;
          else if (type === "expense") bal -= t.debitCents - t.creditCents;
        }
        return { ...f, balanceCents: bal, isNegative: bal < 0 };
      })
    );
    return {
      kind: "program",
      fiscalYear: fy,
      programs: progRows.map((p) => ({
        ...p,
        revenueCents: perProgram.get(p.id)?.rev ?? 0,
        expenseCents: perProgram.get(p.id)?.exp ?? 0,
      })),
      funds: fundRows,
    };
  }

  // ---- org-wide
  const level = access.level as FinanceLevel;
  const [allTotals, fyTotals, funds, feeds, [needsReview], [conn], openingRow, mappedFeeds] = await Promise.all([
    sumLines(db),
    sumLines(db, { from: fy.start, to: fy.end }),
    listFunds(ctx),
    db
      .select({
        glAccountId: finBankAccounts.glAccountId,
        name: finBankAccounts.name,
        balanceCents: finBankAccounts.balanceCents,
        asOf: finBankAccounts.balanceAsOf,
        lastSyncAt: finSimplefinConnections.lastSyncAt,
      })
      .from(finBankAccounts)
      .leftJoin(finSimplefinConnections, eq(finSimplefinConnections.id, finBankAccounts.connectionId))
      .where(eq(finBankAccounts.isActive, true)),
    db.select({ n: count() }).from(finBankTransactions).where(eq(finBankTransactions.status, "new")),
    db.select({ n: count() }).from(finSimplefinConnections).where(isNull(finSimplefinConnections.revokedAt)),
    db
      .select({ id: finJournalEntries.id })
      .from(finJournalEntries)
      .where(and(eq(finJournalEntries.source, "opening_balance"), isNull(finJournalEntries.voidedAt)))
      .limit(1),
    db.select({ id: finBankAccounts.id }).from(finBankAccounts).where(and(eq(finBankAccounts.isActive, true))).limit(1),
  ]);

  const bal = new Map<string, number>();
  for (const a of accts) {
    let d = 0;
    let c = 0;
    for (const t of allTotals) if (t.accountId === a.id) { d += t.debitCents; c += t.creditCents; }
    bal.set(a.id, naturalBalance(a.type, d, c));
  }
  let revenue = 0;
  let expense = 0;
  for (const t of fyTotals) {
    const type = typeOf.get(t.accountId);
    if (type === "revenue") revenue += t.creditCents - t.debitCents;
    if (type === "expense") expense += t.debitCents - t.creditCents;
  }
  const sys = (key: string) => accts.find((a) => a.systemKey === key);

  const banks: BankBalanceRow[] = accts
    .filter((a) => a.isBank && a.isActive)
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      bookCents: bal.get(a.id) ?? 0,
      feeds: feeds
        .filter((f) => f.glAccountId === a.id)
        .map((f) => ({ name: f.name, balanceCents: f.balanceCents, asOf: f.asOf, lastSyncAt: f.lastSyncAt })),
    }));

  const checklist: ChecklistItem[] = [
    {
      key: "encryption",
      label: "Bank connection key is set up",
      done: isEncryptionConfigured(),
      hint: "A server setting (FINANCE_ENCRYPTION_KEY) that protects the saved bank login. Ask whoever hosts the app to add it.",
      href: null,
    },
    {
      key: "opening",
      label: "Opening balances entered",
      done: openingRow.length > 0,
      hint: "Enter what the bank accounts held when you start using this system.",
      href: "/finance/journal/opening-balances",
    },
    {
      key: "bank",
      label: "Bank connected",
      done: conn.n > 0 && mappedFeeds.length > 0,
      hint: "Connect your bank so transactions show up automatically.",
      href: "/finance/banking",
    },
    {
      key: "payout",
      label: "Stripe payout account chosen",
      done: !!settings?.stripePayoutAccountId,
      hint: "Tell us which bank account your Stripe payouts are deposited into.",
      href: "/finance/settings",
    },
    {
      key: "autopost",
      label: "Auto-post start date set",
      done: !!settings?.autoPostStartDate,
      hint: "Registration payments on or after this date are recorded automatically.",
      href: "/finance/settings",
    },
  ];

  return {
    kind: "org",
    level,
    fiscalYear: fy,
    banks,
    stripeBalanceCents: sys("stripe_clearing") ? (bal.get(sys("stripe_clearing")!.id) ?? 0) : 0,
    undepositedCents: sys("undeposited_funds") ? (bal.get(sys("undeposited_funds")!.id) ?? 0) : 0,
    funds: funds
      .filter((f) => f.isActive && (f.systemKey === "general" || f.restriction === "with_donor_restrictions" || f.lineCount > 0))
      .map((f) => ({
        id: f.id,
        name: f.name,
        restriction: f.restriction,
        programName: f.programName,
        balanceCents: f.balanceCents,
        isNegative: f.restriction === "with_donor_restrictions" && f.balanceCents < 0,
      })),
    revenueCents: revenue,
    expenseCents: expense,
    needsReviewCount: needsReview.n,
    lockDate: settings?.lockDate ?? null,
    checklist,
  };
}
