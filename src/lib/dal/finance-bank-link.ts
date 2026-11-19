import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DbTx } from "@/db";
import { finBankAccounts, finBankTransactions } from "@/db/schema";
import type { IsoDate } from "@/lib/finance/dates";
import { DalError } from "./context";

/**
 * Finance 2 shared contract (orchestrator): record a bill payment, invoice payment
 * or donation straight from a bank-feed transaction ("this $120 withdrawal is the
 * check for bill #12"). Callers authorize ("edit"), then inside ONE transaction:
 *   1. const bt = await lockBankTxnForPosting(tx, bankTxnId)   // row lock, must be "new"
 *   2. use bt.glAccountId as the payment/deposit account, bt.postedDate as the default
 *      date, and require the amount to equal bt.amountCents (sign: + money in, - money out)
 *   3. postEntry(...) the module's entry (it must have a line on bt.glAccountId)
 *   4. await linkBankTxn(tx, { bankTxnId, entryId, userId })
 */

export interface LockedBankTxn {
  id: string;
  bankAccountId: string;
  glAccountId: string;
  postedDate: IsoDate;
  /** Signed: positive = money in (deposit), negative = money out. */
  amountCents: number;
  description: string;
  payee: string | null;
}

export async function lockBankTxnForPosting(tx: DbTx, bankTxnId: string): Promise<LockedBankTxn> {
  if (!/^[0-9a-f-]{36}$/i.test(bankTxnId)) throw new DalError("NOT_FOUND", "Bank transaction not found.");
  const [row] = await tx
    .select({
      id: finBankTransactions.id,
      bankAccountId: finBankTransactions.bankAccountId,
      status: finBankTransactions.status,
      postedDate: finBankTransactions.postedDate,
      amountCents: finBankTransactions.amountCents,
      description: finBankTransactions.description,
      payee: finBankTransactions.payee,
      glAccountId: finBankAccounts.glAccountId,
    })
    .from(finBankTransactions)
    .innerJoin(finBankAccounts, eq(finBankAccounts.id, finBankTransactions.bankAccountId))
    .where(eq(finBankTransactions.id, bankTxnId))
    .for("update", { of: finBankTransactions })
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Bank transaction not found.");
  if (row.status !== "new") throw new DalError("INVALID", "That bank transaction has already been handled.");
  if (!row.glAccountId) throw new DalError("INVALID", "That bank account isn't linked to the books yet.");
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    glAccountId: row.glAccountId,
    postedDate: row.postedDate,
    amountCents: row.amountCents,
    description: row.description,
    payee: row.payee,
  };
}

/**
 * Mark the bank transaction as accounted for by `entryId`. Verifies the entry is live
 * and has a line on the bank's GL account whose signed amount equals the transaction.
 */
export async function linkBankTxn(tx: DbTx, args: { bankTxnId: string; entryId: string; userId: string }): Promise<void> {
  const check = await tx.execute<{ ok: boolean }>(sql`
    select exists (
      select 1
      from fin_bank_transactions bt
      join fin_bank_accounts ba on ba.id = bt.bank_account_id
      join fin_journal_entries e on e.id = ${args.entryId}::uuid and e.voided_at is null
      join fin_journal_lines l on l.entry_id = e.id and l.account_id = ba.gl_account_id
      where bt.id = ${args.bankTxnId}::uuid
      group by bt.id, bt.amount_cents
      having sum(l.debit_cents - l.credit_cents) = bt.amount_cents
    ) as ok
  `);
  if (!check.rows[0]?.ok) {
    throw new DalError("INVALID", "The amount doesn't match the bank transaction.");
  }
  await tx
    .update(finBankTransactions)
    .set({ status: "posted", journalEntryId: args.entryId, reviewedByUserId: args.userId, reviewedAt: new Date() })
    .where(eq(finBankTransactions.id, args.bankTxnId));
}
