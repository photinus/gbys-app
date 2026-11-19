import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { type DbOrTx, type DbTx } from "@/db";
import {
  finAccounts,
  finBankTransactions,
  finClearedLines,
  finFunds,
  finJournalEntries,
  finJournalLines,
  finReconciliations,
  finSettings,
  finStripePayouts,
  finEntrySourceEnum,
} from "@/db/schema";
import { isIsoDate, type IsoDate } from "@/lib/finance/dates";
import { formatDate } from "@/lib/format";
import { DalError } from "./context";

/**
 * Posting engine — orchestrator-owned shared contract. ALL writes to
 * fin_journal_entries / fin_journal_lines go through postEntry / voidEntry /
 * replaceEntry, inside the caller's transaction (callers authorize and audit).
 *
 * DB triggers back this up: lines are insert-only, entries can only be voided
 * once, nothing on/before fin_settings.lock_date can be posted or voided, and
 * every entry must balance at COMMIT.
 */

export type FinEntrySource = (typeof finEntrySourceEnum.enumValues)[number];

/** systemKey values seeded in migration 0014 (the app posts to these automatically). */
export type FinSystemAccountKey =
  | "checking"
  | "stripe_clearing"
  | "undeposited_funds"
  | "accounts_receivable"
  | "pledges_receivable"
  | "accounts_payable"
  | "reimbursements_payable"
  | "deferred_revenue"
  | "net_assets_unrestricted"
  | "net_assets_restricted"
  | "contributions"
  | "in_kind_contributions"
  | "registration_revenue"
  | "platform_fee_revenue"
  | "payment_processing_fees"
  | "in_kind_expense";

export type FinAccountType = "asset" | "liability" | "net_assets" | "revenue" | "expense";

/** Debit-normal types report balance = debits - credits; the rest credits - debits. */
export function isDebitNormal(type: FinAccountType): boolean {
  return type === "asset" || type === "expense";
}

export function naturalBalance(type: FinAccountType, debitCents: number, creditCents: number): number {
  return isDebitNormal(type) ? debitCents - creditCents : creditCents - debitCents;
}

export async function systemAccountId(tx: DbOrTx, key: FinSystemAccountKey): Promise<string> {
  const [row] = await tx
    .select({ id: finAccounts.id })
    .from(finAccounts)
    .where(eq(finAccounts.systemKey, key))
    .limit(1);
  if (!row) throw new Error(`System account "${key}" is missing (migration 0014 seeds it).`);
  return row.id;
}

export async function generalFundId(tx: DbOrTx): Promise<string> {
  const [row] = await tx.select({ id: finFunds.id }).from(finFunds).where(eq(finFunds.systemKey, "general")).limit(1);
  if (!row) throw new Error("General Fund is missing (migration 0014 seeds it).");
  return row.id;
}

export async function getLockDate(tx: DbOrTx): Promise<IsoDate | null> {
  const [row] = await tx.select({ lockDate: finSettings.lockDate }).from(finSettings).where(eq(finSettings.id, 1)).limit(1);
  return row?.lockDate ?? null;
}

function closedError(lockDate: IsoDate): DalError {
  return new DalError("INVALID", `The books are closed through ${formatDate(`${lockDate}T12:00:00`)}. Pick a later date or ask a finance admin to reopen the period.`);
}

/** Throws a friendly DalError when `date` falls in a closed period. */
export async function assertPeriodOpen(tx: DbOrTx, date: IsoDate): Promise<void> {
  const lock = await getLockDate(tx);
  if (lock && date <= lock) throw closedError(lock);
}

export interface PostLineInput {
  accountId: string;
  /** Defaults to the General Fund. */
  fundId?: string | null;
  /** Program class (null = organization-wide / management & general). */
  programId?: string | null;
  debitCents?: number;
  creditCents?: number;
  description?: string | null;
}

export interface PostEntryInput {
  entryDate: IsoDate;
  memo: string;
  source: FinEntrySource;
  /** Idempotency key for automatic postings; a live entry with the same (source, sourceRef) is returned as-is. */
  sourceRef?: string | null;
  createdByUserId: string | null;
  lines: PostLineInput[];
}

export interface PostedEntry {
  entryId: string;
  entryNumber: number;
  /** false when an existing entry with the same (source, sourceRef) was returned. */
  created: boolean;
}

function validateLines(lines: PostLineInput[]): void {
  if (lines.length < 2) throw new DalError("INVALID", "A journal entry needs at least two lines.");
  if (lines.length > 200) throw new DalError("INVALID", "Too many lines (200 max).");
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    const d = l.debitCents ?? 0;
    const c = l.creditCents ?? 0;
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) {
      throw new DalError("INVALID", "Amounts must be whole cents and not negative.");
    }
    if ((d === 0) === (c === 0)) throw new DalError("INVALID", "Each line needs either a debit or a credit amount.");
    if (d > 1_000_000_000 || c > 1_000_000_000) throw new DalError("INVALID", "Amount is too large.");
    debits += d;
    credits += c;
  }
  if (debits !== credits) {
    throw new DalError("INVALID", `Debits and credits must be equal (off by ${((debits - credits) / 100).toFixed(2)}).`);
  }
}

async function findLive(tx: DbOrTx, source: FinEntrySource, sourceRef: string) {
  const [row] = await tx
    .select({ id: finJournalEntries.id, entryNumber: finJournalEntries.entryNumber })
    .from(finJournalEntries)
    .where(
      and(eq(finJournalEntries.source, source), eq(finJournalEntries.sourceRef, sourceRef), isNull(finJournalEntries.voidedAt))
    )
    .limit(1);
  return row ?? null;
}

export async function postEntry(tx: DbTx, input: PostEntryInput): Promise<PostedEntry> {
  if (!isIsoDate(input.entryDate)) throw new DalError("INVALID", "Enter a valid date.");
  const memo = input.memo.trim();
  if (!memo) throw new DalError("INVALID", "A memo is required.");
  validateLines(input.lines);

  if (input.sourceRef) {
    // Serialize concurrent auto-postings of the same source object.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fin:${input.source}:${input.sourceRef}`}))`);
    const existing = await findLive(tx, input.source, input.sourceRef);
    if (existing) return { entryId: existing.id, entryNumber: existing.entryNumber, created: false };
  }
  await assertPeriodOpen(tx, input.entryDate);

  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accts = await tx
    .select({ id: finAccounts.id, isActive: finAccounts.isActive, name: finAccounts.name })
    .from(finAccounts)
    .where(inArray(finAccounts.id, accountIds));
  if (accts.length !== accountIds.length) throw new DalError("INVALID", "Unknown account.");
  const inactive = accts.find((a) => !a.isActive);
  if (inactive) throw new DalError("INVALID", `Account "${inactive.name}" is inactive.`);

  const general = await generalFundId(tx);
  const fundIds = [...new Set(input.lines.map((l) => l.fundId ?? general))];
  const funds = await tx
    .select({ id: finFunds.id, isActive: finFunds.isActive, name: finFunds.name })
    .from(finFunds)
    .where(inArray(finFunds.id, fundIds));
  if (funds.length !== fundIds.length) throw new DalError("INVALID", "Unknown fund.");
  const inactiveFund = funds.find((f) => !f.isActive);
  if (inactiveFund) throw new DalError("INVALID", `Fund "${inactiveFund.name}" is inactive.`);

  const [entry] = await tx
    .insert(finJournalEntries)
    .values({
      entryDate: input.entryDate,
      memo: memo.slice(0, 500),
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      createdByUserId: input.createdByUserId,
    })
    .returning({ id: finJournalEntries.id, entryNumber: finJournalEntries.entryNumber });

  await tx.insert(finJournalLines).values(
    input.lines.map((l, i) => ({
      entryId: entry.id,
      lineNo: i + 1,
      accountId: l.accountId,
      fundId: l.fundId ?? general,
      programId: l.programId ?? null,
      debitCents: l.debitCents ?? 0,
      creditCents: l.creditCents ?? 0,
      description: l.description?.trim().slice(0, 500) || null,
    }))
  );
  return { entryId: entry.id, entryNumber: entry.entryNumber, created: true };
}

export interface VoidEntryInput {
  entryId: string;
  userId: string | null;
  reason: string;
}

/**
 * Void a posted entry. Refused when already voided, in a closed period, or when any of
 * its lines were cleared in a COMPLETED reconciliation. Lines cleared in an in-progress
 * reconciliation are un-cleared. Bank transactions and Stripe payouts pointing at the
 * entry are reset (bank txns back to "new") so the inbox shows them again.
 * Returns the bank transaction ids that were reset.
 */
export async function voidEntry(tx: DbTx, input: VoidEntryInput): Promise<{ resetBankTxnIds: string[] }> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DalError("INVALID", "A reason is required.");
  const [entry] = await tx
    .select()
    .from(finJournalEntries)
    .where(eq(finJournalEntries.id, input.entryId))
    .for("update")
    .limit(1);
  if (!entry) throw new DalError("NOT_FOUND", "Journal entry not found.");
  if (entry.voidedAt) throw new DalError("INVALID", "This entry is already voided.");
  await assertPeriodOpen(tx, entry.entryDate);

  const cleared = await tx
    .select({ lineId: finClearedLines.lineId, status: finReconciliations.status })
    .from(finClearedLines)
    .innerJoin(finJournalLines, eq(finJournalLines.id, finClearedLines.lineId))
    .innerJoin(finReconciliations, eq(finReconciliations.id, finClearedLines.reconciliationId))
    .where(eq(finJournalLines.entryId, entry.id));
  if (cleared.some((c) => c.status === "completed")) {
    throw new DalError("INVALID", "This entry is part of a completed bank reconciliation and can't be voided.");
  }
  if (cleared.length) {
    await tx.delete(finClearedLines).where(inArray(finClearedLines.lineId, cleared.map((c) => c.lineId)));
  }

  await tx
    .update(finJournalEntries)
    .set({ voidedAt: new Date(), voidedByUserId: input.userId, voidReason: reason.slice(0, 500) })
    .where(eq(finJournalEntries.id, entry.id));

  const reset = await tx
    .update(finBankTransactions)
    .set({ status: "new", journalEntryId: null, reviewedByUserId: null, reviewedAt: null })
    .where(eq(finBankTransactions.journalEntryId, entry.id))
    .returning({ id: finBankTransactions.id });
  await tx.update(finStripePayouts).set({ journalEntryId: null }).where(eq(finStripePayouts.journalEntryId, entry.id));
  return { resetBankTxnIds: reset.map((r) => r.id) };
}

/**
 * "Edit" a posted entry: void it and post the corrected version (linked via
 * replacedByEntryId). Bank transactions that pointed at the old entry are re-linked
 * to the new one when it still has a line on that bank's GL account.
 */
export async function replaceEntry(
  tx: DbTx,
  input: { entryId: string; userId: string; reason: string; replacement: PostEntryInput }
): Promise<PostedEntry> {
  const linked = await tx
    .select({ id: finBankTransactions.id, bankAccountId: finBankTransactions.bankAccountId })
    .from(finBankTransactions)
    .where(eq(finBankTransactions.journalEntryId, input.entryId));
  await voidEntry(tx, { entryId: input.entryId, userId: input.userId, reason: input.reason });
  const posted = await postEntry(tx, input.replacement);
  await tx
    .update(finJournalEntries)
    .set({ replacedByEntryId: posted.entryId })
    .where(eq(finJournalEntries.id, input.entryId));

  if (linked.length) {
    const rows = await tx.execute<{ id: string }>(sql`
      select bt.id from fin_bank_transactions bt
      join fin_bank_accounts ba on ba.id = bt.bank_account_id
      where bt.id in (${sql.join(linked.map((l) => sql`${l.id}::uuid`), sql`, `)})
        and exists (select 1 from fin_journal_lines jl where jl.entry_id = ${posted.entryId}::uuid and jl.account_id = ba.gl_account_id)
    `);
    const ids = rows.rows.map((r) => r.id);
    if (ids.length) {
      await tx
        .update(finBankTransactions)
        .set({ status: "posted", journalEntryId: posted.entryId, reviewedByUserId: input.userId, reviewedAt: new Date() })
        .where(inArray(finBankTransactions.id, ids));
    }
  }
  return posted;
}

export interface AccountTotalsFilter {
  /** Inclusive LA dates; omit for open-ended. */
  from?: IsoDate;
  to?: IsoDate;
  /** Restrict to these program classes ("all" = no filter). Program-scoped users MUST pass their ids. */
  programIds?: "all" | string[];
  fundId?: string;
  accountIds?: string[];
}

export interface AccountTotalsRow {
  accountId: string;
  fundId: string;
  programId: string | null;
  debitCents: number;
  creditCents: number;
}

/**
 * Sum of non-voided lines grouped by (account, fund, program) — the primitive behind
 * balances, trial balance and reports. Amounts are JS numbers (cents).
 */
export async function sumLines(tx: DbOrTx, f: AccountTotalsFilter = {}): Promise<AccountTotalsRow[]> {
  const conds = [sql`e.voided_at is null`];
  if (f.from) conds.push(sql`e.entry_date >= ${f.from}::date`);
  if (f.to) conds.push(sql`e.entry_date <= ${f.to}::date`);
  if (f.fundId) conds.push(sql`l.fund_id = ${f.fundId}::uuid`);
  if (f.accountIds) {
    if (f.accountIds.length === 0) return [];
    conds.push(sql`l.account_id in (${sql.join(f.accountIds.map((a) => sql`${a}::uuid`), sql`, `)})`);
  }
  if (f.programIds && f.programIds !== "all") {
    if (f.programIds.length === 0) return [];
    conds.push(sql`l.program_id in (${sql.join(f.programIds.map((p) => sql`${p}::uuid`), sql`, `)})`);
  }
  const rows = await tx.execute<{
    account_id: string;
    fund_id: string;
    program_id: string | null;
    debit: string;
    credit: string;
  }>(sql`
    select l.account_id, l.fund_id, l.program_id,
           coalesce(sum(l.debit_cents), 0)::text as debit, coalesce(sum(l.credit_cents), 0)::text as credit
    from fin_journal_lines l
    join fin_journal_entries e on e.id = l.entry_id
    where ${sql.join(conds, sql` and `)}
    group by l.account_id, l.fund_id, l.program_id
  `);
  return rows.rows.map((r) => ({
    accountId: r.account_id,
    fundId: r.fund_id,
    programId: r.program_id,
    debitCents: Number(r.debit),
    creditCents: Number(r.credit),
  }));
}
