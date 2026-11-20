import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx, type DbTx } from "@/db";
import { finAccounts, finContacts, finInvoices, finPaymentApplications, finPayments } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import type { IsoDate } from "@/lib/finance/dates";
import { paymentInSchema, voidPaymentSchema, type PaymentInInput } from "@/lib/validation/finance-invoices";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import { linkBankTxn, lockBankTxnForPosting } from "./finance-bank-link";
import { postEntry, systemAccountId, voidEntry } from "./finance-ledger";

/**
 * Finance 2, RB: payments received against invoices. One payment settles one or more open
 * invoices for ONE customer; the payment amount is the sum of its applications (no unapplied
 * credit). Posting: Dr deposit account (bank or Undeposited funds) / Cr Accounts receivable, one
 * credit line per application; source `invoice_payment`, sourceRef = payment id.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusFor(paid: number, total: number): "open" | "partially_paid" | "paid" {
  return paid >= total ? "paid" : paid > 0 ? "partially_paid" : "open";
}

// ---- Reads ---------------------------------------------------------------------

export interface DepositAccountOption {
  id: string;
  code: string;
  name: string;
  isUndeposited: boolean;
}

export interface OpenInvoiceOption {
  id: string;
  number: number;
  issueDate: IsoDate;
  dueDate: IsoDate | null;
  totalCents: number;
  balanceCents: number;
}

export interface CustomerOpenInvoices {
  contactId: string;
  contactName: string;
  invoices: OpenInvoiceOption[];
}

export interface BankTxnPrefill {
  id: string;
  postedDate: IsoDate;
  amountCents: number;
  description: string;
  payee: string | null;
  glAccountId: string;
}

export interface ReceivePaymentFormData {
  customers: CustomerOpenInvoices[];
  depositAccounts: DepositAccountOption[];
  undepositedFundsId: string;
  /** Set when the form was opened with ?bankTxn= and that deposit is still unhandled. */
  bankTxn: BankTxnPrefill | null;
  bankTxnProblem: string | null;
}

/** Everything the "Receive payment" form needs (customers with open invoices, deposit accounts, bank prefill). */
export async function getReceivePaymentFormData(ctx: SessionContext, bankTxnId?: string | null): Promise<ReceivePaymentFormData> {
  await requireFinance(ctx, "edit");
  const [openRows, accounts, undepositedFundsId] = await Promise.all([
    db
      .select({
        id: finInvoices.id,
        number: finInvoices.number,
        contactId: finInvoices.contactId,
        contactName: finContacts.displayName,
        issueDate: finInvoices.issueDate,
        dueDate: finInvoices.dueDate,
        totalCents: finInvoices.totalCents,
        paidCents: finInvoices.paidCents,
      })
      .from(finInvoices)
      .innerJoin(finContacts, eq(finContacts.id, finInvoices.contactId))
      .where(inArray(finInvoices.status, ["open", "partially_paid"]))
      .orderBy(asc(finContacts.displayName), asc(finInvoices.number)),
    db
      .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, isBank: finAccounts.isBank, systemKey: finAccounts.systemKey })
      .from(finAccounts)
      .where(and(eq(finAccounts.isActive, true), sql`(${finAccounts.isBank} or ${finAccounts.systemKey} = 'undeposited_funds')`))
      .orderBy(asc(finAccounts.code)),
    systemAccountId(db, "undeposited_funds"),
  ]);
  const byCustomer = new Map<string, CustomerOpenInvoices>();
  for (const r of openRows) {
    let c = byCustomer.get(r.contactId);
    if (!c) byCustomer.set(r.contactId, (c = { contactId: r.contactId, contactName: r.contactName, invoices: [] }));
    c.invoices.push({
      id: r.id,
      number: r.number,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      totalCents: r.totalCents,
      balanceCents: r.totalCents - r.paidCents,
    });
  }

  let bankTxn: BankTxnPrefill | null = null;
  let bankTxnProblem: string | null = null;
  if (bankTxnId) {
    try {
      const r = await db.execute<{
        id: string;
        posted_date: string;
        amount: string;
        description: string;
        payee: string | null;
        gl: string | null;
        status: string;
      }>(sql`
        select bt.id, bt.posted_date::text as posted_date, bt.amount_cents::text as amount, bt.description, bt.payee,
               ba.gl_account_id as gl, bt.status
        from fin_bank_transactions bt join fin_bank_accounts ba on ba.id = bt.bank_account_id
        where bt.id = ${UUID_RE.test(bankTxnId) ? bankTxnId : "00000000-0000-0000-0000-000000000000"}::uuid
      `);
      const row = r.rows[0];
      if (!row) bankTxnProblem = "That bank transaction wasn't found.";
      else if (row.status !== "new") bankTxnProblem = "That bank transaction has already been handled.";
      else if (!row.gl) bankTxnProblem = "That bank account isn't linked to the books yet.";
      else if (Number(row.amount) <= 0) bankTxnProblem = "That bank transaction is money going out, not a deposit.";
      else
        bankTxn = {
          id: row.id,
          postedDate: row.posted_date,
          amountCents: Number(row.amount),
          description: row.description,
          payee: row.payee,
          glAccountId: row.gl,
        };
    } catch {
      bankTxnProblem = "That bank transaction wasn't found.";
    }
  }

  return {
    customers: [...byCustomer.values()],
    depositAccounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, isUndeposited: a.systemKey === "undeposited_funds" })),
    undepositedFundsId,
    bankTxn,
    bankTxnProblem,
  };
}

export interface PaymentInRow {
  id: string;
  paymentDate: IsoDate;
  contactId: string;
  contactName: string;
  method: string;
  reference: string | null;
  amountCents: number;
  depositAccountName: string;
  invoiceNumbers: number[];
  voidedAt: Date | null;
  voidReason: string | null;
  journalEntryId: string | null;
}

export async function listPaymentsIn(ctx: SessionContext, f: { contactId?: string; limit?: number } = {}): Promise<PaymentInRow[]> {
  await requireFinance(ctx, "view_all");
  const rows = await db
    .select({
      id: finPayments.id,
      paymentDate: finPayments.paymentDate,
      contactId: finPayments.contactId,
      contactName: finContacts.displayName,
      method: finPayments.method,
      reference: finPayments.reference,
      amountCents: finPayments.amountCents,
      depositAccountName: finAccounts.name,
      voidedAt: finPayments.voidedAt,
      voidReason: finPayments.voidReason,
      journalEntryId: finPayments.journalEntryId,
    })
    .from(finPayments)
    .innerJoin(finContacts, eq(finContacts.id, finPayments.contactId))
    .innerJoin(finAccounts, eq(finAccounts.id, finPayments.accountId))
    .where(
      and(eq(finPayments.direction, "in"), f.contactId && UUID_RE.test(f.contactId) ? eq(finPayments.contactId, f.contactId) : undefined)
    )
    .orderBy(desc(finPayments.paymentDate), desc(finPayments.createdAt))
    .limit(Math.min(Math.max(f.limit ?? 300, 1), 1000));
  if (rows.length === 0) return [];
  const apps = await db
    .select({ paymentId: finPaymentApplications.paymentId, number: finInvoices.number })
    .from(finPaymentApplications)
    .innerJoin(finInvoices, eq(finInvoices.id, finPaymentApplications.invoiceId))
    .where(inArray(finPaymentApplications.paymentId, rows.map((r) => r.id)));
  const nums = new Map<string, number[]>();
  for (const a of apps) nums.set(a.paymentId, [...(nums.get(a.paymentId) ?? []), a.number]);
  return rows.map((r) => ({ ...r, invoiceNumbers: (nums.get(r.id) ?? []).sort((a, b) => a - b) }));
}

// ---- Record ----------------------------------------------------------------------

async function assertDepositAccount(tx: DbOrTx, accountId: string): Promise<void> {
  const [a] = await tx
    .select({ isBank: finAccounts.isBank, systemKey: finAccounts.systemKey, isActive: finAccounts.isActive, name: finAccounts.name })
    .from(finAccounts)
    .where(eq(finAccounts.id, accountId))
    .limit(1);
  if (!a) throw new DalError("INVALID", "Pick where the money was deposited.");
  if (!a.isActive) throw new DalError("INVALID", `Account “${a.name}” is inactive.`);
  if (!a.isBank && a.systemKey !== "undeposited_funds") {
    throw new DalError("INVALID", "Deposit to a bank account or to Undeposited funds.");
  }
}

export async function recordPaymentIn(
  ctx: SessionContext,
  input: PaymentInInput
): Promise<{ paymentId: string; entryId: string; entryNumber: number }> {
  await requireFinance(ctx, "edit");
  const data = paymentInSchema.parse(input);
  const ids = data.applications.map((a) => a.invoiceId);
  if (new Set(ids).size !== ids.length) throw new DalError("INVALID", "An invoice can only appear once in a payment.");
  const total = data.applications.reduce((s, a) => s + a.amountCents, 0);
  if (total > 2_000_000_000) throw new DalError("INVALID", "The payment total is too large.");

  return db.transaction(async (tx) => {
    let accountId = data.accountId;
    let bankTxnId: string | null = null;
    if (data.bankTxnId) {
      const bt = await lockBankTxnForPosting(tx, data.bankTxnId);
      if (bt.amountCents <= 0) throw new DalError("INVALID", "That bank transaction is money going out. Use it for a bill payment instead.");
      if (bt.amountCents !== total) {
        throw new DalError(
          "INVALID",
          `The invoice amounts add up to ${(total / 100).toFixed(2)} but the bank deposit is ${(bt.amountCents / 100).toFixed(2)}. They must match.`
        );
      }
      accountId = bt.glAccountId;
      bankTxnId = bt.id;
    }
    await assertDepositAccount(tx, accountId);

    const [contact] = await tx
      .select({ name: finContacts.displayName, isCustomer: finContacts.isCustomer })
      .from(finContacts)
      .where(eq(finContacts.id, data.contactId))
      .limit(1);
    if (!contact) throw new DalError("INVALID", "Pick a customer.");

    // Lock the invoices in a stable order (concurrent payments / voids can't deadlock or over-apply).
    const invoices = await tx
      .select()
      .from(finInvoices)
      .where(inArray(finInvoices.id, ids))
      .orderBy(asc(finInvoices.id))
      .for("update");
    if (invoices.length !== ids.length) throw new DalError("INVALID", "One of those invoices no longer exists.");
    const byId = new Map(invoices.map((i) => [i.id, i]));
    for (const app of data.applications) {
      const inv = byId.get(app.invoiceId)!;
      if (inv.contactId !== data.contactId) throw new DalError("INVALID", `Invoice #${inv.number} belongs to a different customer.`);
      if (inv.status !== "open" && inv.status !== "partially_paid") {
        throw new DalError("INVALID", `Invoice #${inv.number} is ${inv.status === "paid" ? "already paid" : inv.status === "void" ? "void" : "not issued yet"}.`);
      }
      const balance = inv.totalCents - inv.paidCents;
      if (app.amountCents > balance) {
        throw new DalError("INVALID", `Invoice #${inv.number} only has ${(balance / 100).toFixed(2)} left to pay.`);
      }
    }

    const [pay] = await tx
      .insert(finPayments)
      .values({
        direction: "in",
        contactId: data.contactId,
        paymentDate: data.paymentDate,
        amountCents: total,
        method: data.method,
        reference: data.reference,
        accountId,
        memo: data.memo,
        createdByUserId: ctx.userId,
      })
      .returning({ id: finPayments.id });
    await tx.insert(finPaymentApplications).values(data.applications.map((a) => ({ paymentId: pay.id, invoiceId: a.invoiceId, amountCents: a.amountCents })));
    for (const app of data.applications) {
      const inv = byId.get(app.invoiceId)!;
      const paid = inv.paidCents + app.amountCents;
      await tx.update(finInvoices).set({ paidCents: paid, status: statusFor(paid, inv.totalCents) }).where(eq(finInvoices.id, inv.id));
    }

    const ar = await systemAccountId(tx, "accounts_receivable");
    const numbers = data.applications.map((a) => byId.get(a.invoiceId)!.number);
    const posted = await postEntry(tx, {
      entryDate: data.paymentDate,
      memo: `Payment from ${contact.name}${data.reference ? ` (${data.reference})` : ""} for invoice${numbers.length > 1 ? "s" : ""} ${numbers.map((n) => `#${n}`).join(", ")}`,
      source: "invoice_payment",
      sourceRef: pay.id,
      createdByUserId: ctx.userId,
      lines: [
        { accountId, debitCents: total, description: data.method },
        ...data.applications.map((a) => ({
          accountId: ar,
          creditCents: a.amountCents,
          description: `Invoice #${byId.get(a.invoiceId)!.number}`,
        })),
      ],
    });
    await tx.update(finPayments).set({ journalEntryId: posted.entryId }).where(eq(finPayments.id, pay.id));
    if (bankTxnId) await linkBankTxn(tx, { bankTxnId, entryId: posted.entryId, userId: ctx.userId });

    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.payment_recorded",
        targetType: "fin_payment",
        targetId: pay.id,
        metadata: { direction: "in", customer: contact.name, totalCents: total, invoices: numbers, method: data.method, bankTxnId, entryNumber: posted.entryNumber },
      },
      tx
    );
    return { paymentId: pay.id, entryId: posted.entryId, entryNumber: posted.entryNumber };
  });
}

// ---- Void --------------------------------------------------------------------------

/**
 * Void a received payment: voids its journal entry (a linked bank transaction returns to the
 * inbox) and recomputes paidCents and the status of every invoice it was applied to.
 */
export async function voidPaymentIn(ctx: SessionContext, input: { paymentId: string; reason: string }): Promise<void> {
  await requireFinance(ctx, "edit");
  const data = voidPaymentSchema.parse(input);
  await db.transaction(async (tx: DbTx) => {
    const [pay] = await tx.select().from(finPayments).where(eq(finPayments.id, data.paymentId)).for("update").limit(1);
    if (!pay || pay.direction !== "in") throw new DalError("NOT_FOUND", "Payment not found.");
    if (pay.voidedAt) throw new DalError("INVALID", "This payment is already void.");
    const apps = await tx.select().from(finPaymentApplications).where(eq(finPaymentApplications.paymentId, pay.id));
    const invoiceIds = [...new Set(apps.map((a) => a.invoiceId).filter((x): x is string => !!x))];
    if (invoiceIds.length) {
      await tx.select({ id: finInvoices.id }).from(finInvoices).where(inArray(finInvoices.id, invoiceIds)).orderBy(asc(finInvoices.id)).for("update");
    }
    if (pay.journalEntryId) {
      await voidEntry(tx, { entryId: pay.journalEntryId, userId: ctx.userId, reason: `Payment voided: ${data.reason}` });
    }
    await tx
      .update(finPayments)
      .set({ voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: data.reason })
      .where(eq(finPayments.id, pay.id));
    // Recompute from live payments only (this one is now void).
    for (const invoiceId of invoiceIds) {
      const r = await tx.execute<{ paid: string }>(sql`
        select coalesce(sum(a.amount_cents), 0)::text as paid
        from fin_payment_applications a join fin_payments p on p.id = a.payment_id
        where a.invoice_id = ${invoiceId}::uuid and p.voided_at is null
      `);
      const paid = Number(r.rows[0].paid);
      const [inv] = await tx.select({ total: finInvoices.totalCents, status: finInvoices.status }).from(finInvoices).where(eq(finInvoices.id, invoiceId));
      if (inv.status === "void") continue;
      await tx.update(finInvoices).set({ paidCents: paid, status: statusFor(paid, inv.total) }).where(eq(finInvoices.id, invoiceId));
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.payment_voided",
        targetType: "fin_payment",
        targetId: pay.id,
        metadata: { direction: "in", reason: data.reason, totalCents: pay.amountCents, invoices: invoiceIds.length },
      },
      tx
    );
  });
}
