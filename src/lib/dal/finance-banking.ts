import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx, type DbTx } from "@/db";
import {
  finAccounts,
  finBankAccounts,
  finBankRules,
  finBankTransactions,
  finFunds,
  finJournalEntries,
  finSimplefinConnections,
  programs,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/crypto";
import { addDays, laDateOf, laToday, type IsoDate } from "@/lib/finance/dates";
import { laDateInputToUtc } from "@/lib/format";
import { claimSetupToken, fetchAccounts, SimpleFinError, type SfAccount } from "@/lib/simplefin";
import {
  bulkCategorizeSchema,
  categorizeSchema,
  connectSchema,
  excludeSchema,
  mappingSchema,
  matchSchema,
  transferSchema,
  type InboxTab,
} from "@/lib/validation/finance-banking";
import { DalError, type SessionContext } from "./context";
import { canEditBooks, isFinanceAdmin, requireFinance } from "./finance-access";
import { postEntry, voidEntry, type PostLineInput } from "./finance-ledger";
import { assertCategoryAccount, firstMatchingRule, loadActiveRules, type BankRuleRow } from "./finance-rules";

/**
 * Banking (workstream FB): SimpleFIN connections, bank-account mapping, sync, the bank
 * inbox (categorize / split / transfer / match / exclude / undo) and auto-match.
 *
 * Every journal write goes through postEntry / voidEntry inside a db.transaction that
 * first locks the bank transaction row (`select … for update`). The access URL never
 * leaves this module: connection reads never select the ciphertext column.
 */

const SYNC_THROTTLE_MS = 15 * 60 * 1000;
const LOOKBACK_DAYS = 14;
const LOOKBACK_DAYS_AFTER_PROBLEM = 45;
const MATCH_WINDOW_DAYS = 5;

type TxnRow = typeof finBankTransactions.$inferSelect;
type BankRow = typeof finBankAccounts.$inferSelect;

function firstOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

// ---- shared lookups ------------------------------------------------------------

async function lockTxn(tx: DbTx, txnId: string): Promise<{ txn: TxnRow; bank: BankRow }> {
  const [txn] = await tx.select().from(finBankTransactions).where(eq(finBankTransactions.id, txnId)).for("update").limit(1);
  if (!txn) throw new DalError("NOT_FOUND", "Transaction not found.");
  const [bank] = await tx.select().from(finBankAccounts).where(eq(finBankAccounts.id, txn.bankAccountId)).limit(1);
  if (!bank) throw new DalError("NOT_FOUND", "Bank account not found.");
  return { txn, bank };
}

function requireGl(bank: BankRow): string {
  if (!bank.glAccountId) throw new DalError("INVALID", "Map this bank account to a ledger account first.");
  return bank.glAccountId;
}

async function assertFundAndProgram(tx: DbOrTx, fundId: string | null | undefined, programId: string | null | undefined) {
  if (fundId) {
    const [f] = await tx.select({ isActive: finFunds.isActive }).from(finFunds).where(eq(finFunds.id, fundId)).limit(1);
    if (!f || !f.isActive) throw new DalError("INVALID", "Choose an active fund.");
  }
  if (programId) {
    const [p] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, programId), isNull(programs.deletedAt)))
      .limit(1);
    if (!p) throw new DalError("INVALID", "That program no longer exists.");
  }
}

// ---- match candidates ----------------------------------------------------------

export interface MatchCandidate {
  entryId: string;
  entryNumber: number;
  entryDate: string;
  memo: string;
  source: string;
}

/**
 * Live journal entries that could already account for each bank transaction: a line on
 * the account's GL account with the same signed amount (deposit = debit, withdrawal =
 * credit), dated within ±5 days, not yet linked to a transaction of that bank account.
 */
async function findCandidates(tx: DbOrTx, txnIds: string[]): Promise<Map<string, MatchCandidate[]>> {
  const out = new Map<string, MatchCandidate[]>();
  if (txnIds.length === 0) return out;
  const res = await tx.execute<{
    txn_id: string;
    entry_id: string;
    entry_number: string;
    entry_date: string;
    memo: string;
    source: string;
  }>(sql`
    select t.id as txn_id, e.id as entry_id, e.entry_number::text as entry_number,
           e.entry_date::text as entry_date, e.memo, e.source::text as source
    from fin_bank_transactions t
    join fin_bank_accounts ba on ba.id = t.bank_account_id
    join fin_journal_entries e
      on e.voided_at is null
     and e.entry_date between t.posted_date - ${MATCH_WINDOW_DAYS}::int and t.posted_date + ${MATCH_WINDOW_DAYS}::int
    where t.id in (${sql.join(txnIds.map((i) => sql`${i}::uuid`), sql`, `)})
      and ba.gl_account_id is not null
      and exists (
        select 1 from fin_journal_lines l
        where l.entry_id = e.id and l.account_id = ba.gl_account_id
          and ((t.amount_cents > 0 and l.debit_cents = t.amount_cents)
            or (t.amount_cents < 0 and l.credit_cents = -t.amount_cents)))
      and not exists (
        select 1 from fin_bank_transactions t2
        where t2.bank_account_id = t.bank_account_id and t2.journal_entry_id = e.id)
    order by t.id, abs(e.entry_date - t.posted_date), e.entry_number
  `);
  for (const r of res.rows) {
    const list = out.get(r.txn_id) ?? [];
    list.push({ entryId: r.entry_id, entryNumber: Number(r.entry_number), entryDate: r.entry_date, memo: r.memo, source: r.source });
    out.set(r.txn_id, list);
  }
  return out;
}

const AUTO_MATCH_SOURCES = new Set(["stripe_payout", "transfer"]);

/** Auto-link when exactly one candidate is a Stripe payout or transfer entry. */
async function tryAutoMatch(tx: DbTx, txn: TxnRow, actorUserId: string | null): Promise<boolean> {
  if (txn.status !== "new") return false;
  const cands = (await findCandidates(tx, [txn.id])).get(txn.id) ?? [];
  const auto = cands.filter((c) => AUTO_MATCH_SOURCES.has(c.source));
  if (auto.length !== 1) return false;
  const c = auto[0];
  try {
    await tx.transaction(async (sp) => {
      await sp
        .update(finBankTransactions)
        .set({ status: "posted", journalEntryId: c.entryId, suggestedRuleId: null, reviewedByUserId: actorUserId, reviewedAt: new Date() })
        .where(eq(finBankTransactions.id, txn.id));
      await writeAudit(
        {
          actorUserId,
          action: "finance.bank_txn_matched",
          targetType: "fin_bank_txn",
          targetId: txn.id,
          metadata: { auto: true, entryNumber: c.entryNumber, source: c.source, amountCents: txn.amountCents },
        },
        sp
      );
    });
    return true;
  } catch {
    return false; // e.g. the entry was linked concurrently; leave it in the inbox
  }
}

// ---- posting -------------------------------------------------------------------

export interface CategoryLine {
  accountId: string;
  fundId?: string | null;
  programId?: string | null;
  amountCents: number;
  memo?: string | null;
}

/** Post a "new" bank transaction as a categorized entry (bank line + category lines). */
async function postCategorized(
  tx: DbTx,
  txn: TxnRow,
  bank: BankRow,
  lines: CategoryLine[],
  actorUserId: string | null,
  memo?: string | null
): Promise<{ entryId: string; entryNumber: number }> {
  if (txn.status !== "new") throw new DalError("INVALID", "This transaction has already been handled.");
  const gl = requireGl(bank);
  const abs = Math.abs(txn.amountCents);
  const total = lines.reduce((s, l) => s + l.amountCents, 0);
  if (total !== abs) {
    throw new DalError("INVALID", `The parts add up to ${(total / 100).toFixed(2)} but the transaction is ${(abs / 100).toFixed(2)}.`);
  }
  for (const l of lines) {
    await assertCategoryAccount(tx, l.accountId);
    await assertFundAndProgram(tx, l.fundId, l.programId);
  }
  const deposit = txn.amountCents > 0;
  const postLines: PostLineInput[] = [
    deposit ? { accountId: gl, debitCents: abs } : { accountId: gl, creditCents: abs },
    ...lines.map<PostLineInput>((l) => ({
      accountId: l.accountId,
      fundId: l.fundId ?? null,
      programId: l.programId ?? null,
      ...(deposit ? { creditCents: l.amountCents } : { debitCents: l.amountCents }),
      description: l.memo ?? null,
    })),
  ];
  const posted = await postEntry(tx, {
    entryDate: txn.postedDate,
    memo: (memo?.trim() || txn.description).slice(0, 500),
    source: "bank",
    sourceRef: txn.id,
    createdByUserId: actorUserId,
    lines: postLines,
  });
  await tx
    .update(finBankTransactions)
    .set({ status: "posted", journalEntryId: posted.entryId, suggestedRuleId: null, reviewedByUserId: actorUserId, reviewedAt: new Date() })
    .where(eq(finBankTransactions.id, txn.id));
  await writeAudit(
    {
      actorUserId,
      action: "finance.bank_txn_posted",
      targetType: "fin_bank_txn",
      targetId: txn.id,
      metadata: { entryNumber: posted.entryNumber, amountCents: txn.amountCents, parts: lines.length, kind: "categorize" },
    },
    tx
  );
  return { entryId: posted.entryId, entryNumber: posted.entryNumber };
}

function ruleLine(rule: BankRuleRow, abs: number): CategoryLine {
  return { accountId: rule.accountId, fundId: rule.fundId, programId: rule.programId, amountCents: abs, memo: rule.memo };
}

export async function categorizeTxn(ctx: SessionContext, input: unknown): Promise<{ entryNumber: number }> {
  await requireFinance(ctx, "edit");
  const v = categorizeSchema.parse(input);
  return db.transaction(async (tx) => {
    const { txn, bank } = await lockTxn(tx, v.txnId);
    const r = await postCategorized(tx, txn, bank, v.lines, ctx.userId, v.memo);
    return { entryNumber: r.entryNumber };
  });
}

/** Accept the rule suggestion shown on a transaction. */
export async function acceptSuggestion(ctx: SessionContext, txnId: string): Promise<{ entryNumber: number }> {
  await requireFinance(ctx, "edit");
  return db.transaction(async (tx) => {
    const { txn, bank } = await lockTxn(tx, txnId);
    if (!txn.suggestedRuleId) throw new DalError("INVALID", "There is no suggestion for this transaction.");
    const [rule] = await tx.select().from(finBankRules).where(eq(finBankRules.id, txn.suggestedRuleId)).limit(1);
    if (!rule || !rule.isActive) throw new DalError("INVALID", "That rule is no longer active. Choose a category instead.");
    const r = await postCategorized(tx, txn, bank, [ruleLine(rule, Math.abs(txn.amountCents))], ctx.userId, null);
    return { entryNumber: r.entryNumber };
  });
}

export interface BulkResult {
  posted: number;
  failed: { txnId: string; error: string }[];
}

/** Same category for many transactions; each posts in its own transaction so one failure doesn't block the rest. */
export async function bulkCategorize(ctx: SessionContext, input: unknown): Promise<BulkResult> {
  await requireFinance(ctx, "edit");
  const v = bulkCategorizeSchema.parse(input);
  const result: BulkResult = { posted: 0, failed: [] };
  for (const txnId of [...new Set(v.txnIds)]) {
    try {
      await db.transaction(async (tx) => {
        const { txn, bank } = await lockTxn(tx, txnId);
        await postCategorized(tx, txn, bank, [{ accountId: v.accountId, fundId: v.fundId, programId: v.programId, amountCents: Math.abs(txn.amountCents) }], ctx.userId, null);
      });
      result.posted++;
    } catch (err) {
      if (err instanceof DalError) result.failed.push({ txnId, error: err.message });
      else throw err;
    }
  }
  return result;
}

/** Transfer between two of our bank accounts (entry source "transfer"). */
export async function transferTxn(ctx: SessionContext, input: unknown): Promise<{ entryNumber: number }> {
  await requireFinance(ctx, "edit");
  const v = transferSchema.parse(input);
  return db.transaction(async (tx) => {
    const { txn, bank } = await lockTxn(tx, v.txnId);
    if (txn.status !== "new") throw new DalError("INVALID", "This transaction has already been handled.");
    const gl = requireGl(bank);
    if (v.toGlAccountId === gl) throw new DalError("INVALID", "Choose a different account to transfer to or from.");
    const [other] = await tx
      .select({ id: finAccounts.id, name: finAccounts.name, isBank: finAccounts.isBank, isActive: finAccounts.isActive })
      .from(finAccounts)
      .where(eq(finAccounts.id, v.toGlAccountId))
      .limit(1);
    if (!other || !other.isBank || !other.isActive) throw new DalError("INVALID", "Choose one of your bank accounts.");
    const [mine] = await tx.select({ name: finAccounts.name }).from(finAccounts).where(eq(finAccounts.id, gl)).limit(1);
    const abs = Math.abs(txn.amountCents);
    const deposit = txn.amountCents > 0;
    const posted = await postEntry(tx, {
      entryDate: txn.postedDate,
      memo: (v.memo?.trim() || (deposit ? `Transfer from ${other.name}` : `Transfer to ${other.name}`)).slice(0, 500),
      source: "transfer",
      sourceRef: txn.id,
      createdByUserId: ctx.userId,
      lines: deposit
        ? [
            { accountId: gl, debitCents: abs, description: `Transfer in (${mine?.name ?? "account"})` },
            { accountId: other.id, creditCents: abs, description: `Transfer out (${other.name})` },
          ]
        : [
            { accountId: other.id, debitCents: abs, description: `Transfer in (${other.name})` },
            { accountId: gl, creditCents: abs, description: `Transfer out (${mine?.name ?? "account"})` },
          ],
    });
    await tx
      .update(finBankTransactions)
      .set({ status: "posted", journalEntryId: posted.entryId, suggestedRuleId: null, reviewedByUserId: ctx.userId, reviewedAt: new Date() })
      .where(eq(finBankTransactions.id, txn.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.bank_txn_posted",
        targetType: "fin_bank_txn",
        targetId: txn.id,
        metadata: { entryNumber: posted.entryNumber, amountCents: txn.amountCents, kind: "transfer", otherAccount: other.name },
      },
      tx
    );

    // If the other side of this transfer is already waiting in the inbox, link it now.
    const others = await tx
      .select({ id: finBankTransactions.id })
      .from(finBankTransactions)
      .innerJoin(finBankAccounts, eq(finBankAccounts.id, finBankTransactions.bankAccountId))
      .where(
        and(
          eq(finBankAccounts.glAccountId, other.id),
          eq(finBankTransactions.status, "new"),
          eq(finBankTransactions.amountCents, -txn.amountCents),
          sql`abs(${finBankTransactions.postedDate} - ${txn.postedDate}::date) <= ${MATCH_WINDOW_DAYS}::int`
        )
      );
    for (const o of others) {
      const [row] = await tx.select().from(finBankTransactions).where(eq(finBankTransactions.id, o.id)).for("update").limit(1);
      if (row) await tryAutoMatch(tx, row, ctx.userId);
    }
    return { entryNumber: posted.entryNumber };
  });
}

/** Link a new bank transaction to an existing entry that already accounts for it. */
export async function matchTxn(ctx: SessionContext, input: unknown): Promise<{ entryNumber: number }> {
  await requireFinance(ctx, "edit");
  const v = matchSchema.parse(input);
  return db.transaction(async (tx) => {
    const { txn } = await lockTxn(tx, v.txnId);
    if (txn.status !== "new") throw new DalError("INVALID", "This transaction has already been handled.");
    const cands = (await findCandidates(tx, [txn.id])).get(txn.id) ?? [];
    const c = cands.find((x) => x.entryId === v.entryId);
    if (!c) throw new DalError("INVALID", "That entry no longer matches this transaction. Refresh and try again.");
    await tx
      .update(finBankTransactions)
      .set({ status: "posted", journalEntryId: c.entryId, suggestedRuleId: null, reviewedByUserId: ctx.userId, reviewedAt: new Date() })
      .where(eq(finBankTransactions.id, txn.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.bank_txn_matched",
        targetType: "fin_bank_txn",
        targetId: txn.id,
        metadata: { auto: false, entryNumber: c.entryNumber, source: c.source, amountCents: txn.amountCents },
      },
      tx
    );
    return { entryNumber: c.entryNumber };
  });
}

export async function excludeTxn(ctx: SessionContext, input: unknown): Promise<void> {
  await requireFinance(ctx, "edit");
  const v = excludeSchema.parse(input);
  await db.transaction(async (tx) => {
    const { txn } = await lockTxn(tx, v.txnId);
    if (txn.status !== "new") throw new DalError("INVALID", "Only transactions in New can be excluded. Undo it first.");
    // The feed's raw payload is the only free-form column on the row: keep the reason there.
    await tx
      .update(finBankTransactions)
      .set({
        status: "excluded",
        suggestedRuleId: null,
        reviewedByUserId: ctx.userId,
        reviewedAt: new Date(),
        raw: sql`coalesce(${finBankTransactions.raw}, '{}'::jsonb) || ${JSON.stringify({ gbysExclude: { reason: v.reason, note: v.note } })}::jsonb`,
      })
      .where(eq(finBankTransactions.id, txn.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.bank_txn_excluded",
        targetType: "fin_bank_txn",
        targetId: txn.id,
        metadata: { reason: v.reason, note: v.note, amountCents: txn.amountCents },
      },
      tx
    );
  });
}

export async function restoreTxn(ctx: SessionContext, txnId: string): Promise<void> {
  await requireFinance(ctx, "edit");
  await db.transaction(async (tx) => {
    const { txn } = await lockTxn(tx, txnId);
    if (txn.status !== "excluded") throw new DalError("INVALID", "This transaction isn't excluded.");
    await tx
      .update(finBankTransactions)
      .set({
        status: "new",
        reviewedByUserId: null,
        reviewedAt: null,
        raw: sql`coalesce(${finBankTransactions.raw}, '{}'::jsonb) - 'gbysExclude'`,
      })
      .where(eq(finBankTransactions.id, txn.id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.bank_txn_restored", targetType: "fin_bank_txn", targetId: txn.id, metadata: { from: "excluded" } },
      tx
    );
  });
}

/**
 * Undo a posted transaction. When the entry was created from this transaction (source
 * bank/transfer with sourceRef = txn id) the entry is voided; a matched pre-existing
 * entry is just unlinked.
 */
export async function undoTxn(ctx: SessionContext, txnId: string): Promise<{ voided: boolean }> {
  await requireFinance(ctx, "edit");
  return db.transaction(async (tx) => {
    const { txn } = await lockTxn(tx, txnId);
    if (txn.status !== "posted" || !txn.journalEntryId) throw new DalError("INVALID", "This transaction isn't posted.");
    const [entry] = await tx
      .select({
        id: finJournalEntries.id,
        source: finJournalEntries.source,
        sourceRef: finJournalEntries.sourceRef,
        entryNumber: finJournalEntries.entryNumber,
        voidedAt: finJournalEntries.voidedAt,
      })
      .from(finJournalEntries)
      .where(eq(finJournalEntries.id, txn.journalEntryId))
      .limit(1);
    if (!entry) throw new DalError("NOT_FOUND", "Journal entry not found.");
    const createdHere = (entry.source === "bank" || entry.source === "transfer") && entry.sourceRef === txn.id;
    let resetCount = 0;
    if (createdHere) {
      const r = await voidEntry(tx, { entryId: entry.id, userId: ctx.userId, reason: "Undone from the bank inbox" });
      resetCount = r.resetBankTxnIds.length;
    } else {
      await tx
        .update(finBankTransactions)
        .set({ status: "new", journalEntryId: null, reviewedByUserId: null, reviewedAt: null })
        .where(eq(finBankTransactions.id, txn.id));
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.bank_txn_restored",
        targetType: "fin_bank_txn",
        targetId: txn.id,
        metadata: { undo: true, entryNumber: entry.entryNumber, voided: createdHere, resetCount },
      },
      tx
    );
    return { voided: createdHere };
  });
}

// ---- rules at import time -------------------------------------------------------

type ProcessOutcome = "skip" | "matched" | "posted" | "suggested" | "none";

async function processNewTxn(txnId: string, rules: BankRuleRow[], actorUserId: string | null): Promise<ProcessOutcome> {
  return db.transaction(async (tx): Promise<ProcessOutcome> => {
    const [txn] = await tx.select().from(finBankTransactions).where(eq(finBankTransactions.id, txnId)).for("update").limit(1);
    if (!txn || txn.status !== "new") return "skip";
    const [bank] = await tx.select().from(finBankAccounts).where(eq(finBankAccounts.id, txn.bankAccountId)).limit(1);
    if (!bank?.glAccountId) return "skip";
    if (await tryAutoMatch(tx, txn, actorUserId)) return "matched";
    const rule = firstMatchingRule(rules, txn);
    if (!rule) {
      if (txn.suggestedRuleId) await tx.update(finBankTransactions).set({ suggestedRuleId: null }).where(eq(finBankTransactions.id, txn.id));
      return "none";
    }
    if (rule.autoPost) {
      try {
        await tx.transaction((sp) => postCategorized(sp, txn, bank, [ruleLine(rule, Math.abs(txn.amountCents))], actorUserId, null));
        return "posted";
      } catch {
        // Closed period, inactive account, ... — fall back to a suggestion.
      }
    }
    await tx.update(finBankTransactions).set({ suggestedRuleId: rule.id }).where(eq(finBankTransactions.id, txn.id));
    return "suggested";
  });
}

async function processNewTxns(ids: string[], actorUserId: string | null) {
  const rules = await loadActiveRules(db);
  const counts = { matched: 0, posted: 0, suggested: 0 };
  for (const id of ids) {
    const o = await processNewTxn(id, rules, actorUserId);
    if (o === "matched") counts.matched++;
    else if (o === "posted") counts.posted++;
    else if (o === "suggested") counts.suggested++;
  }
  return counts;
}

/** Run auto-match and rules over every transaction currently in New (manual "Run rules now"). */
export async function applyRulesToNew(ctx: SessionContext): Promise<{ checked: number; matched: number; posted: number; suggested: number }> {
  await requireFinance(ctx, "edit");
  const rows = await db
    .select({ id: finBankTransactions.id })
    .from(finBankTransactions)
    .where(eq(finBankTransactions.status, "new"))
    .orderBy(asc(finBankTransactions.postedDate))
    .limit(2000);
  const c = await processNewTxns(rows.map((r) => r.id), ctx.userId);
  return { checked: rows.length, ...c };
}

// ---- sync ----------------------------------------------------------------------

export interface ConnectionSyncResult {
  connectionId: string;
  label: string;
  status: "ok" | "partial" | "error";
  imported: number;
  matched: number;
  posted: number;
  suggested: number;
  messages: string[];
}

function safeMessage(err: unknown): string {
  if (err instanceof SimpleFinError) return err.message;
  if (err instanceof Error && err.name === "EncryptionUnavailableError") return err.message;
  console.error("[finance-banking] sync failed:", err instanceof Error ? err.name : "unknown");
  return "Unexpected error while syncing. Check the server logs.";
}

type ConnRow = Pick<typeof finSimplefinConnections.$inferSelect, "id" | "label" | "accessUrlCiphertext" | "lastSyncAt" | "lastSyncStatus">;

async function upsertAccountsFromFeed(connectionId: string, feed: SfAccount[], existing: BankRow[]): Promise<BankRow[]> {
  const bySf = new Map(existing.filter((b) => b.simplefinAccountId).map((b) => [b.simplefinAccountId!, b]));
  const today = laToday();
  const out = [...existing];
  for (const a of feed) {
    const known = bySf.get(a.id);
    const balanceFields = {
      balanceCents: a.balanceCents,
      availableBalanceCents: a.availableBalanceCents,
      balanceAsOf: a.balanceDate,
    };
    if (known) {
      await db
        .update(finBankAccounts)
        .set({ ...balanceFields, ...(a.institution ? { institution: a.institution } : {}) })
        .where(eq(finBankAccounts.id, known.id));
    } else {
      const [row] = await db
        .insert(finBankAccounts)
        .values({
          connectionId,
          simplefinAccountId: a.id,
          institution: a.institution,
          name: a.name,
          currency: a.currency,
          importStartDate: firstOfMonth(today),
          ...balanceFields,
        })
        .onConflictDoNothing()
        .returning();
      if (row) out.push(row);
    }
  }
  return out;
}

/** One connection: fetch, import new posted transactions, then match + rules. */
async function syncConnection(conn: ConnRow, actorUserId: string | null, now: Date): Promise<ConnectionSyncResult> {
  const result: ConnectionSyncResult = { connectionId: conn.id, label: conn.label, status: "ok", imported: 0, matched: 0, posted: 0, suggested: 0, messages: [] };
  try {
    const accessUrl = decryptSecret(conn.accessUrlCiphertext);
    const today = laToday(now);
    let accounts = await db.select().from(finBankAccounts).where(and(eq(finBankAccounts.connectionId, conn.id), eq(finBankAccounts.isActive, true)));
    const mapped = accounts.filter((b) => b.glAccountId);

    let sfAccounts: SfAccount[];
    let bridgeErrors: string[];
    const startByAccount = new Map<string, IsoDate>();
    if (mapped.length === 0) {
      const r = await fetchAccounts(accessUrl, { balancesOnly: true });
      sfAccounts = r.accounts;
      bridgeErrors = r.errors;
    } else {
      const haveTxns = new Set(
        (
          await db
            .selectDistinct({ id: finBankTransactions.bankAccountId })
            .from(finBankTransactions)
            .where(inArray(finBankTransactions.bankAccountId, mapped.map((m) => m.id)))
        ).map((r) => r.id)
      );
      const lookback = conn.lastSyncStatus && conn.lastSyncStatus !== "ok" ? LOOKBACK_DAYS_AFTER_PROBLEM : LOOKBACK_DAYS;
      for (const b of mapped) {
        const importStart = b.importStartDate ?? firstOfMonth(today);
        let start = importStart;
        if (conn.lastSyncAt && haveTxns.has(b.id)) {
          const lookbackStart = addDays(laDateOf(conn.lastSyncAt), -lookback);
          if (lookbackStart > start) start = lookbackStart;
        }
        startByAccount.set(b.id, start);
      }
      const earliest = [...startByAccount.values()].sort()[0];
      const r = await fetchAccounts(accessUrl, {
        startDate: Math.floor(laDateInputToUtc(earliest, false).getTime() / 1000),
        endDate: Math.floor(laDateInputToUtc(addDays(today, 1), false).getTime() / 1000),
      });
      sfAccounts = r.accounts;
      bridgeErrors = r.errors;
    }
    result.messages.push(...bridgeErrors);

    accounts = await upsertAccountsFromFeed(conn.id, sfAccounts, accounts);
    const feedById = new Map(sfAccounts.map((a) => [a.id, a]));
    const newIds: string[] = [];
    for (const b of accounts) {
      if (!b.glAccountId || !b.simplefinAccountId) continue;
      const feed = feedById.get(b.simplefinAccountId);
      if (!feed) continue;
      if (feed.currency.toUpperCase() !== "USD") {
        result.messages.push(`Skipped "${b.name}": only US dollar accounts are supported.`);
        continue;
      }
      const importStart = b.importStartDate ?? firstOfMonth(today);
      const rows = feed.transactions
        .filter((t) => !t.pending && t.amountCents !== 0)
        .map((t) => ({ t, postedDate: laDateOf(t.postedAt) }))
        .filter((x) => x.postedDate >= importStart)
        .map(({ t, postedDate }) => ({
          bankAccountId: b.id,
          externalId: t.id,
          postedDate,
          amountCents: t.amountCents,
          description: t.description,
          payee: t.payee,
          memo: t.memo,
          raw: t.raw,
        }));
      for (let i = 0; i < rows.length; i += 200) {
        const inserted = await db
          .insert(finBankTransactions)
          .values(rows.slice(i, i + 200))
          .onConflictDoNothing({ target: [finBankTransactions.bankAccountId, finBankTransactions.externalId] })
          .returning({ id: finBankTransactions.id });
        newIds.push(...inserted.map((r) => r.id));
      }
    }
    result.imported = newIds.length;
    if (newIds.length) {
      const c = await processNewTxns(newIds, actorUserId);
      result.matched = c.matched;
      result.posted = c.posted;
      result.suggested = c.suggested;
    }
    result.status = bridgeErrors.length ? "partial" : "ok";
    await db
      .update(finSimplefinConnections)
      .set({ lastSyncAt: now, lastSyncStatus: result.status, lastSyncMessages: result.messages })
      .where(eq(finSimplefinConnections.id, conn.id));
  } catch (err) {
    result.status = "error";
    result.messages = [safeMessage(err)];
    // lastSyncAt is deliberately left alone so the next sync looks back from the last good one.
    await db
      .update(finSimplefinConnections)
      .set({ lastSyncStatus: "error", lastSyncMessages: result.messages })
      .where(eq(finSimplefinConnections.id, conn.id));
  }
  return result;
}

async function auditSync(actorUserId: string | null, results: ConnectionSyncResult[], trigger: "cron" | "manual") {
  await writeAudit({
    actorUserId,
    action: "finance.bank_synced",
    targetType: "fin_connection",
    targetId: results.length === 1 ? results[0].connectionId : "all",
    metadata: {
      trigger,
      connections: results.length,
      imported: results.reduce((s, r) => s + r.imported, 0),
      matched: results.reduce((s, r) => s + r.matched, 0),
      posted: results.reduce((s, r) => s + r.posted, 0),
      suggested: results.reduce((s, r) => s + r.suggested, 0),
      errors: results.filter((r) => r.status === "error").length,
    },
  });
}

const connColumns = {
  id: finSimplefinConnections.id,
  label: finSimplefinConnections.label,
  accessUrlCiphertext: finSimplefinConnections.accessUrlCiphertext,
  lastSyncAt: finSimplefinConnections.lastSyncAt,
  lastSyncStatus: finSimplefinConnections.lastSyncStatus,
};

/**
 * System sync of every active SimpleFIN connection (called by the cron route).
 * No actor and no throttle: the cron runs once a day.
 */
export async function syncAllConnections(): Promise<{ connections: number; imported: number; errors: string[] }> {
  const conns = await db
    .select(connColumns)
    .from(finSimplefinConnections)
    .where(isNull(finSimplefinConnections.revokedAt))
    .orderBy(asc(finSimplefinConnections.createdAt));
  const results: ConnectionSyncResult[] = [];
  const errors: string[] = [];
  for (const c of conns) {
    const r = await syncConnection(c, null, new Date());
    results.push(r);
    if (r.status === "error") errors.push(`${r.label}: ${r.messages.join(" ")}`);
  }
  if (results.length) await auditSync(null, results, "cron");
  return { connections: conns.length, imported: results.reduce((s, r) => s + r.imported, 0), errors };
}

export interface SyncNowResult {
  synced: number;
  throttled: number;
  imported: number;
  matched: number;
  posted: number;
  suggested: number;
  messages: string[];
}

/**
 * Manual sync (`edit`). SimpleFIN Bridge allows ~24 requests a day, so a connection that
 * synced in the last 15 minutes is skipped; when every connection is that fresh the call
 * is refused with a friendly message.
 */
export async function syncNow(ctx: SessionContext): Promise<SyncNowResult> {
  await requireFinance(ctx, "edit");
  const conns = await db
    .select(connColumns)
    .from(finSimplefinConnections)
    .where(isNull(finSimplefinConnections.revokedAt))
    .orderBy(asc(finSimplefinConnections.createdAt));
  if (conns.length === 0) throw new DalError("INVALID", "Connect a bank first.");
  const now = new Date();
  const out: SyncNowResult = { synced: 0, throttled: 0, imported: 0, matched: 0, posted: 0, suggested: 0, messages: [] };
  const results: ConnectionSyncResult[] = [];
  let soonest = Infinity;
  for (const c of conns) {
    const age = c.lastSyncAt ? now.getTime() - c.lastSyncAt.getTime() : Infinity;
    if (age < SYNC_THROTTLE_MS) {
      out.throttled++;
      soonest = Math.min(soonest, SYNC_THROTTLE_MS - age);
      continue;
    }
    // Compare-and-set claim so two simultaneous clicks don't both hit the bridge.
    const claimed = await db
      .update(finSimplefinConnections)
      .set({ lastSyncAt: now })
      .where(
        and(
          eq(finSimplefinConnections.id, c.id),
          c.lastSyncAt ? eq(finSimplefinConnections.lastSyncAt, c.lastSyncAt) : isNull(finSimplefinConnections.lastSyncAt)
        )
      )
      .returning({ id: finSimplefinConnections.id });
    if (claimed.length === 0) {
      out.throttled++;
      continue;
    }
    const r = await syncConnection(c, ctx.userId, now);
    if (r.status === "error") {
      // Failed syncs don't count against the throttle: restore the previous time.
      await db.update(finSimplefinConnections).set({ lastSyncAt: c.lastSyncAt }).where(eq(finSimplefinConnections.id, c.id));
    }
    results.push(r);
    out.synced++;
    out.imported += r.imported;
    out.matched += r.matched;
    out.posted += r.posted;
    out.suggested += r.suggested;
    for (const m of r.messages) out.messages.push(conns.length > 1 ? `${r.label}: ${m}` : m);
  }
  if (out.synced === 0) {
    const mins = Math.max(1, Math.ceil(soonest / 60000));
    throw new DalError("INVALID", `Your bank was just synced. To stay within SimpleFIN's daily limit, try again in about ${mins} minute${mins === 1 ? "" : "s"}.`);
  }
  await auditSync(ctx.userId, results, "manual");
  return out;
}

// ---- connections & accounts ----------------------------------------------------

export interface ConnectionView {
  id: string;
  label: string;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncMessages: string[];
  createdAt: Date;
  /** Earliest time a manual sync is allowed again (null = now). */
  nextSyncAllowedAt: Date | null;
}

export interface BankAccountView {
  id: string;
  connectionId: string | null;
  connectionLabel: string | null;
  institution: string | null;
  name: string;
  currency: string;
  glAccountId: string | null;
  glAccountLabel: string | null;
  importStartDate: string | null;
  balanceCents: number | null;
  availableBalanceCents: number | null;
  balanceAsOf: Date | null;
  hasTransactions: boolean;
  newCount: number;
}

export interface BankingOverview {
  encryptionConfigured: boolean;
  canEdit: boolean;
  canAdmin: boolean;
  connections: ConnectionView[];
  accounts: BankAccountView[];
  /** isBank GL accounts that can be mapped to. */
  glOptions: { id: string; label: string; mappedTo: string | null }[];
  newCount: number;
}

export async function getBankingOverview(ctx: SessionContext): Promise<BankingOverview> {
  const access = await requireFinance(ctx, "view_all");
  const connRows = await db
    .select({
      id: finSimplefinConnections.id,
      label: finSimplefinConnections.label,
      lastSyncAt: finSimplefinConnections.lastSyncAt,
      lastSyncStatus: finSimplefinConnections.lastSyncStatus,
      lastSyncMessages: finSimplefinConnections.lastSyncMessages,
      createdAt: finSimplefinConnections.createdAt,
    })
    .from(finSimplefinConnections)
    .where(isNull(finSimplefinConnections.revokedAt))
    .orderBy(asc(finSimplefinConnections.createdAt));
  const now = Date.now();
  const connections: ConnectionView[] = connRows.map((c) => {
    const next = c.lastSyncAt ? c.lastSyncAt.getTime() + SYNC_THROTTLE_MS : null;
    return { ...c, lastSyncMessages: c.lastSyncMessages ?? [], nextSyncAllowedAt: next && next > now ? new Date(next) : null };
  });
  const connLabel = new Map(connections.map((c) => [c.id, c.label]));

  const glRows = await db
    .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name })
    .from(finAccounts)
    .where(and(eq(finAccounts.isBank, true), eq(finAccounts.isActive, true)))
    .orderBy(asc(finAccounts.code));
  const banks = await db
    .select()
    .from(finBankAccounts)
    .where(eq(finBankAccounts.isActive, true))
    .orderBy(asc(finBankAccounts.createdAt), asc(finBankAccounts.name));
  const counts = await db
    .select({
      bankAccountId: finBankTransactions.bankAccountId,
      total: sql<number>`count(*)::int`,
      news: sql<number>`count(*) filter (where ${finBankTransactions.status} = 'new')::int`,
    })
    .from(finBankTransactions)
    .groupBy(finBankTransactions.bankAccountId);
  const cmap = new Map(counts.map((c) => [c.bankAccountId, c]));
  const glLabel = new Map(glRows.map((g) => [g.id, `${g.code} ${g.name}`]));
  const accounts: BankAccountView[] = banks
    .filter((b) => !b.connectionId || connLabel.has(b.connectionId))
    .map((b) => ({
      id: b.id,
      connectionId: b.connectionId,
      connectionLabel: b.connectionId ? (connLabel.get(b.connectionId) ?? null) : null,
      institution: b.institution,
      name: b.name,
      currency: b.currency,
      glAccountId: b.glAccountId,
      glAccountLabel: b.glAccountId ? (glLabel.get(b.glAccountId) ?? null) : null,
      importStartDate: b.importStartDate,
      balanceCents: b.balanceCents,
      availableBalanceCents: b.availableBalanceCents,
      balanceAsOf: b.balanceAsOf,
      hasTransactions: (cmap.get(b.id)?.total ?? 0) > 0,
      newCount: cmap.get(b.id)?.news ?? 0,
    }));
  const mappedBy = new Map(banks.filter((b) => b.glAccountId).map((b) => [b.glAccountId!, b]));
  const glOptions = glRows.map((g) => {
    const holder = mappedBy.get(g.id);
    return { id: g.id, label: `${g.code} ${g.name}`, mappedTo: holder && holder.isActive ? holder.name : null };
  });
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(finBankTransactions)
    .where(eq(finBankTransactions.status, "new"));
  return {
    encryptionConfigured: isEncryptionConfigured(),
    canEdit: canEditBooks(access),
    canAdmin: isFinanceAdmin(access),
    connections,
    accounts,
    glOptions,
    newCount: n,
  };
}

export async function connectSimplefin(ctx: SessionContext, input: unknown): Promise<{ accounts: number; warning: string | null }> {
  await requireFinance(ctx, "admin");
  const v = connectSchema.parse(input);
  if (!isEncryptionConfigured()) {
    throw new DalError("INVALID", "Bank connections can't be saved yet: FINANCE_ENCRYPTION_KEY is not set on the server. Ask your developer to add it.");
  }
  let accessUrl: string;
  try {
    accessUrl = await claimSetupToken(v.token);
  } catch (err) {
    if (err instanceof SimpleFinError) throw new DalError("INVALID", err.message);
    throw err;
  }
  // The token is single-use, so store the access URL before doing anything else.
  const [conn] = await db
    .insert(finSimplefinConnections)
    .values({ label: v.label, accessUrlCiphertext: encryptSecret(accessUrl), createdByUserId: ctx.userId })
    .returning({ id: finSimplefinConnections.id });

  let warning: string | null = null;
  let count = 0;
  try {
    const r = await fetchAccounts(accessUrl, { balancesOnly: true });
    const rows = await upsertAccountsFromFeed(conn.id, r.accounts, []);
    count = rows.length;
    await db
      .update(finSimplefinConnections)
      .set({ lastSyncStatus: r.errors.length ? "partial" : "ok", lastSyncMessages: r.errors })
      .where(eq(finSimplefinConnections.id, conn.id));
    if (r.errors.length) warning = r.errors.join(" ");
  } catch (err) {
    warning = `Connected, but the first check of your accounts failed: ${safeMessage(err)} Try "Sync now" in a few minutes.`;
    await db
      .update(finSimplefinConnections)
      .set({ lastSyncStatus: "error", lastSyncMessages: [warning] })
      .where(eq(finSimplefinConnections.id, conn.id));
  }
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.bank_connected",
    targetType: "fin_connection",
    targetId: conn.id,
    metadata: { label: v.label, accounts: count },
  });
  return { accounts: count, warning };
}

export async function disconnectSimplefin(ctx: SessionContext, connectionId: string): Promise<void> {
  await requireFinance(ctx, "admin");
  await db.transaction(async (tx) => {
    const [conn] = await tx
      .update(finSimplefinConnections)
      .set({ revokedAt: new Date() })
      .where(and(eq(finSimplefinConnections.id, connectionId), isNull(finSimplefinConnections.revokedAt)))
      .returning({ id: finSimplefinConnections.id, label: finSimplefinConnections.label });
    if (!conn) throw new DalError("NOT_FOUND", "Connection not found.");
    // Accounts keep their ledger mapping (history stays readable); mapping the same ledger
    // account again later adopts their transactions (see updateBankAccountMapping).
    const accts = await tx
      .update(finBankAccounts)
      .set({ isActive: false })
      .where(eq(finBankAccounts.connectionId, connectionId))
      .returning({ id: finBankAccounts.id });
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.bank_disconnected", targetType: "fin_connection", targetId: conn.id, metadata: { label: conn.label, accounts: accts.length } },
      tx
    );
  });
}

/** Map a feed account to a bank ledger account and set the import start date. */
export async function updateBankAccountMapping(ctx: SessionContext, input: unknown): Promise<void> {
  await requireFinance(ctx, "edit");
  const v = mappingSchema.parse(input);
  await db.transaction(async (tx) => {
    const [bank] = await tx.select().from(finBankAccounts).where(eq(finBankAccounts.id, v.bankAccountId)).for("update").limit(1);
    if (!bank || !bank.isActive) throw new DalError("NOT_FOUND", "Bank account not found.");
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(finBankTransactions)
      .where(eq(finBankTransactions.bankAccountId, bank.id));

    if (v.glAccountId !== bank.glAccountId) {
      if (n > 0) {
        throw new DalError("INVALID", "This account already has imported transactions, so its ledger account can't be changed.");
      }
      if (v.glAccountId) {
        const [gl] = await tx
          .select({ isBank: finAccounts.isBank, isActive: finAccounts.isActive, name: finAccounts.name })
          .from(finAccounts)
          .where(eq(finAccounts.id, v.glAccountId))
          .limit(1);
        if (!gl || !gl.isBank || !gl.isActive) throw new DalError("INVALID", "Choose one of your bank or cash accounts.");
        const [holder] = await tx
          .select()
          .from(finBankAccounts)
          .where(and(eq(finBankAccounts.glAccountId, v.glAccountId), sql`${finBankAccounts.id} <> ${bank.id}`))
          .for("update")
          .limit(1);
        if (holder?.isActive) {
          throw new DalError("INVALID", `"${gl.name}" is already linked to ${holder.name}. Unlink that account first.`);
        }
        if (holder) {
          // A disconnected feed used this ledger account: adopt its history so nothing is imported twice.
          await tx.update(finBankTransactions).set({ bankAccountId: bank.id }).where(eq(finBankTransactions.bankAccountId, holder.id));
          await tx.update(finBankAccounts).set({ glAccountId: null }).where(eq(finBankAccounts.id, holder.id));
        }
      }
    }

    await tx
      .update(finBankAccounts)
      .set({ glAccountId: v.glAccountId, importStartDate: v.importStartDate })
      .where(eq(finBankAccounts.id, bank.id));

    // Moving the start date earlier (or newly mapping) needs a backfill: forgetting the last
    // sync time makes the next sync fetch from the import start date.
    if (bank.connectionId && (!bank.importStartDate || v.importStartDate < bank.importStartDate || v.glAccountId !== bank.glAccountId)) {
      await tx.update(finSimplefinConnections).set({ lastSyncAt: null }).where(eq(finSimplefinConnections.id, bank.connectionId));
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.bank_account_updated",
        targetType: "fin_bank_account",
        targetId: bank.id,
        metadata: { name: bank.name, glAccountId: v.glAccountId, importStartDate: v.importStartDate },
      },
      tx
    );
  });
}

// ---- inbox ---------------------------------------------------------------------

export interface InboxRow {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  /** Ledger account this feed posts to. */
  glAccountId: string | null;
  postedDate: string;
  description: string;
  payee: string | null;
  memo: string | null;
  amountCents: number;
  status: "new" | "posted" | "excluded";
  entryId: string | null;
  entryNumber: number | null;
  entrySource: string | null;
  entryMemo: string | null;
  /** Posted rows: undo voids the entry (created here) or just unlinks a matched one. */
  undoVoids: boolean;
  suggestion: { ruleId: string; ruleName: string; accountLabel: string; autoPost: boolean } | null;
  candidates: MatchCandidate[];
  excludeReason: string | null;
  excludeNote: string | null;
}

export interface InboxPage {
  tab: InboxTab;
  rows: InboxRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { new: number; posted: number; excluded: number };
  accounts: { id: string; name: string }[];
}

export async function listInbox(
  ctx: SessionContext,
  opts: { tab: InboxTab; bankAccountId?: string | null; page?: number; pageSize?: number }
): Promise<InboxPage> {
  await requireFinance(ctx, "view_all");
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);
  const acctFilter = opts.bankAccountId ? eq(finBankTransactions.bankAccountId, opts.bankAccountId) : undefined;

  const countRows = await db
    .select({ status: finBankTransactions.status, n: sql<number>`count(*)::int` })
    .from(finBankTransactions)
    .where(acctFilter)
    .groupBy(finBankTransactions.status);
  const counts = { new: 0, posted: 0, excluded: 0 };
  for (const c of countRows) counts[c.status] = c.n;

  const rows = await db
    .select({
      t: finBankTransactions,
      bankName: finBankAccounts.name,
      bankGlAccountId: finBankAccounts.glAccountId,
      entryNumber: finJournalEntries.entryNumber,
      entrySource: finJournalEntries.source,
      entrySourceRef: finJournalEntries.sourceRef,
      entryMemo: finJournalEntries.memo,
      ruleName: finBankRules.name,
      ruleAutoPost: finBankRules.autoPost,
      ruleAccountCode: finAccounts.code,
      ruleAccountName: finAccounts.name,
    })
    .from(finBankTransactions)
    .innerJoin(finBankAccounts, eq(finBankAccounts.id, finBankTransactions.bankAccountId))
    .leftJoin(finJournalEntries, eq(finJournalEntries.id, finBankTransactions.journalEntryId))
    .leftJoin(finBankRules, eq(finBankRules.id, finBankTransactions.suggestedRuleId))
    .leftJoin(finAccounts, eq(finAccounts.id, finBankRules.accountId))
    .where(and(eq(finBankTransactions.status, opts.tab), acctFilter))
    .orderBy(
      desc(finBankTransactions.postedDate),
      desc(finBankTransactions.importedAt),
      asc(finBankTransactions.id)
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const cands = opts.tab === "new" ? await findCandidates(db, rows.map((r) => r.t.id)) : new Map<string, MatchCandidate[]>();
  const accounts = await db
    .select({ id: finBankAccounts.id, name: finBankAccounts.name })
    .from(finBankAccounts)
    .where(sql`${finBankAccounts.glAccountId} is not null`)
    .orderBy(asc(finBankAccounts.name));

  return {
    tab: opts.tab,
    page,
    pageSize,
    total: counts[opts.tab],
    counts,
    accounts,
    rows: rows.map((r) => {
      const ex = (r.t.raw as { gbysExclude?: { reason?: string; note?: string | null } } | null)?.gbysExclude;
      return {
        id: r.t.id,
        bankAccountId: r.t.bankAccountId,
        bankAccountName: r.bankName,
        glAccountId: r.bankGlAccountId,
        postedDate: r.t.postedDate,
        description: r.t.description,
        payee: r.t.payee,
        memo: r.t.memo,
        amountCents: r.t.amountCents,
        status: r.t.status,
        entryId: r.t.journalEntryId,
        entryNumber: r.entryNumber ?? null,
        entrySource: r.entrySource ?? null,
        entryMemo: r.entryMemo ?? null,
        undoVoids: (r.entrySource === "bank" || r.entrySource === "transfer") && r.entrySourceRef === r.t.id,
        suggestion:
          r.t.suggestedRuleId && r.ruleName
            ? { ruleId: r.t.suggestedRuleId, ruleName: r.ruleName, accountLabel: `${r.ruleAccountCode} ${r.ruleAccountName}`, autoPost: !!r.ruleAutoPost }
            : null,
        candidates: cands.get(r.t.id) ?? [],
        excludeReason: ex?.reason ?? null,
        excludeNote: ex?.note ?? null,
      };
    }),
  };
}

export interface BankingOptions {
  /** Active non-bank accounts a transaction can be categorized to. */
  categories: { id: string; code: string; name: string; type: string; subtype: string | null }[];
  /** Active bank/cash accounts (transfer targets). */
  bankAccounts: { id: string; code: string; name: string }[];
  funds: { id: string; name: string; restriction: string; isGeneral: boolean }[];
  programs: { id: string; name: string }[];
  feedAccounts: { id: string; name: string }[];
}

export async function getBankingOptions(ctx: SessionContext): Promise<BankingOptions> {
  await requireFinance(ctx, "view_all");
  const [accts, funds, progs, feeds] = await Promise.all([
    db
      .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, type: finAccounts.type, subtype: finAccounts.subtype, isBank: finAccounts.isBank })
      .from(finAccounts)
      .where(eq(finAccounts.isActive, true))
      .orderBy(asc(finAccounts.code)),
    db
      .select({ id: finFunds.id, name: finFunds.name, restriction: finFunds.restriction, systemKey: finFunds.systemKey })
      .from(finFunds)
      .where(eq(finFunds.isActive, true))
      .orderBy(asc(finFunds.name)),
    db
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(and(isNull(programs.deletedAt), eq(programs.isActive, true)))
      .orderBy(asc(programs.name)),
    db
      .select({ id: finBankAccounts.id, name: finBankAccounts.name })
      .from(finBankAccounts)
      .where(sql`${finBankAccounts.glAccountId} is not null`)
      .orderBy(asc(finBankAccounts.name)),
  ]);
  return {
    categories: accts.filter((a) => !a.isBank).map(({ isBank: _b, ...a }) => a),
    bankAccounts: accts.filter((a) => a.isBank).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    funds: funds.map((f) => ({ id: f.id, name: f.name, restriction: f.restriction, isGeneral: f.systemKey === "general" })),
    programs: progs,
    feedAccounts: feeds,
  };
}
