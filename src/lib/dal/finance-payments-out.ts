import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  finAccounts,
  finBankAccounts,
  finBankTransactions,
  finBills,
  finContacts,
  finJournalEntries,
  finPaymentApplications,
  finPayments,
  users,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sendHtmlEmail } from "@/lib/email";
import { type IsoDate } from "@/lib/finance/dates";
import { amountInWords, statusFromPaid } from "@/lib/finance/payables-math";
import { appUrl, reimbursementPaidEmail } from "@/lib/finance/payables-email";
import { formatCents, formatDob } from "@/lib/format";
import {
  PAYMENT_METHOD_LABELS,
  paymentInputSchema,
  voidReasonSchema,
  type PaymentInput,
} from "@/lib/validation/finance-bills";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import { linkBankTxn, lockBankTxnForPosting } from "./finance-bank-link";
import { assertPeriodOpen, postEntry, systemAccountId, voidEntry } from "./finance-ledger";

/**
 * Payments out (Finance 2, PB): pay one or several approved bills / reimbursements for one
 * contact. Posts Dr A/P (2000) or Reimbursements payable (2010), one line per application,
 * Cr the paying account. Void recomputes paid amounts and statuses.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;

export interface OpenBillRow {
  id: string;
  kind: "bill" | "reimbursement";
  contactId: string;
  contactName: string;
  vendorInvoiceNumber: string | null;
  memo: string;
  billDate: IsoDate;
  dueDate: IsoDate | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: string;
}

/** Approved and part-paid bills (the "what can I pay" list). Bookkeepers only. */
export async function listOpenBillsForPayment(ctx: SessionContext): Promise<OpenBillRow[]> {
  await requireFinance(ctx, "edit");
  const rows = await db
    .select({
      id: finBills.id,
      kind: finBills.kind,
      contactId: finBills.contactId,
      contactName: finContacts.displayName,
      vendorInvoiceNumber: finBills.vendorInvoiceNumber,
      memo: finBills.memo,
      billDate: finBills.billDate,
      dueDate: finBills.dueDate,
      totalCents: finBills.totalCents,
      paidCents: finBills.paidCents,
      status: finBills.status,
    })
    .from(finBills)
    .innerJoin(finContacts, eq(finContacts.id, finBills.contactId))
    .where(inArray(finBills.status, ["approved", "partially_paid"]))
    .orderBy(asc(finContacts.displayName), asc(finBills.dueDate))
    .limit(2000);
  return rows.map((r) => ({ ...r, balanceCents: r.totalCents - r.paidCents }));
}

export interface PaymentOptions {
  accounts: { id: string; code: string; name: string }[];
}

/** Accounts money can be paid from: active bank / cash accounts. */
export async function getPaymentOptions(ctx: SessionContext): Promise<PaymentOptions> {
  await requireFinance(ctx, "edit");
  const accounts = await db
    .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name })
    .from(finAccounts)
    .where(and(eq(finAccounts.isBank, true), eq(finAccounts.isActive, true)))
    .orderBy(asc(finAccounts.code));
  return { accounts };
}

export interface BankTxnPrefill {
  id: string;
  postedDate: IsoDate;
  /** Positive cents leaving the account. */
  outCents: number;
  description: string;
  payee: string | null;
  glAccountId: string;
}

/** Details of a new bank-feed withdrawal for the pay form (`?bankTxn=`). */
export async function getBankTxnPrefill(ctx: SessionContext, bankTxnId: string): Promise<BankTxnPrefill> {
  await requireFinance(ctx, "edit");
  if (!UUID_RE.test(bankTxnId)) throw new DalError("NOT_FOUND", "Bank transaction not found.");
  const [row] = await db
    .select({
      id: finBankTransactions.id,
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
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Bank transaction not found.");
  if (row.status !== "new") throw new DalError("INVALID", "That bank transaction has already been handled.");
  if (!row.glAccountId) throw new DalError("INVALID", "That bank account isn't linked to the books yet.");
  if (row.amountCents >= 0) throw new DalError("INVALID", "That bank transaction is money coming in, not a payment.");
  return {
    id: row.id,
    postedDate: row.postedDate,
    outCents: -row.amountCents,
    description: row.description,
    payee: row.payee,
    glAccountId: row.glAccountId,
  };
}

export interface RecordPaymentResult {
  id: string;
  entryNumber: number;
}

/** Record a payment against one or more approved bills of one contact. */
export async function recordPayment(ctx: SessionContext, input: PaymentInput): Promise<RecordPaymentResult> {
  await requireFinance(ctx, "edit");
  const data = paymentInputSchema.parse(input);
  const billIds = data.applications.map((x) => x.billId);
  if (new Set(billIds).size !== billIds.length) throw new DalError("INVALID", "Each bill can only appear once in a payment.");
  const total = data.applications.reduce((s, x) => s + x.amountCents, 0);

  const result = await db.transaction(async (tx) => {
    let accountId = data.accountId;
    let bankMemo: string | null = null;
    if (data.bankTxnId) {
      const bt = await lockBankTxnForPosting(tx, data.bankTxnId);
      if (bt.amountCents >= 0) throw new DalError("INVALID", "That bank transaction is money coming in, not a payment.");
      if (total !== -bt.amountCents) {
        throw new DalError("INVALID", `The bills add up to ${formatCents(total)} but the bank transaction is ${formatCents(-bt.amountCents)}. They must match.`);
      }
      accountId = bt.glAccountId;
      bankMemo = bt.description;
    }
    const [acct] = await tx
      .select({ id: finAccounts.id, isBank: finAccounts.isBank, isActive: finAccounts.isActive, name: finAccounts.name })
      .from(finAccounts)
      .where(eq(finAccounts.id, accountId))
      .limit(1);
    if (!acct || !acct.isBank || !acct.isActive) throw new DalError("INVALID", "Pick an active bank or cash account to pay from.");
    await assertPeriodOpen(tx, data.paymentDate);

    const [contact] = await tx
      .select({ id: finContacts.id, name: finContacts.displayName })
      .from(finContacts)
      .where(eq(finContacts.id, data.contactId))
      .limit(1);
    if (!contact) throw new DalError("INVALID", "Choose who you're paying.");

    // Lock the bills in a stable order so concurrent payments can't deadlock or overpay.
    const bills = await tx
      .select()
      .from(finBills)
      .where(inArray(finBills.id, billIds))
      .orderBy(asc(finBills.id))
      .for("update");
    if (bills.length !== billIds.length) throw new DalError("NOT_FOUND", "One of the bills no longer exists.");
    const byId = new Map(bills.map((b) => [b.id, b]));
    for (const app of data.applications) {
      const b = byId.get(app.billId)!;
      if (b.contactId !== contact.id) throw new DalError("INVALID", "All bills in one payment must be for the same payee.");
      if (b.status !== "approved" && b.status !== "partially_paid") {
        throw new DalError("INVALID", b.status === "paid" ? "One of those bills is already paid." : "Only approved bills can be paid.");
      }
      const balance = b.totalCents - b.paidCents;
      if (app.amountCents > balance) {
        throw new DalError("INVALID", `You can't pay more than the balance (${formatCents(balance)}) on a bill.`);
      }
    }

    const [pay] = await tx
      .insert(finPayments)
      .values({
        direction: "out",
        contactId: contact.id,
        paymentDate: data.paymentDate,
        amountCents: total,
        method: data.method,
        reference: data.reference,
        accountId,
        memo: data.memo ?? bankMemo,
        createdByUserId: ctx.userId,
      })
      .returning({ id: finPayments.id });
    await tx.insert(finPaymentApplications).values(data.applications.map((x) => ({ paymentId: pay.id, billId: x.billId, amountCents: x.amountCents })));

    const apId = await systemAccountId(tx, "accounts_payable");
    const reimbId = await systemAccountId(tx, "reimbursements_payable");
    for (const app of data.applications) {
      const b = byId.get(app.billId)!;
      const paid = b.paidCents + app.amountCents;
      await tx.update(finBills).set({ paidCents: paid, status: statusFromPaid(b.totalCents, paid) }).where(eq(finBills.id, b.id));
    }
    const methodText = PAYMENT_METHOD_LABELS[data.method];
    const memo = `Payment to ${contact.name} (${methodText}${data.reference ? ` ${data.reference}` : ""})`;
    const posted = await postEntry(tx, {
      entryDate: data.paymentDate,
      memo,
      source: "bill_payment",
      sourceRef: pay.id,
      createdByUserId: ctx.userId,
      lines: [
        ...data.applications.map((x) => {
          const b = byId.get(x.billId)!;
          return {
            accountId: b.kind === "reimbursement" ? reimbId : apId,
            debitCents: x.amountCents,
            description: `${b.vendorInvoiceNumber ? `#${b.vendorInvoiceNumber} ` : ""}${b.memo}`.slice(0, 200),
          };
        }),
        { accountId, creditCents: total, description: contact.name },
      ],
    });
    await tx.update(finPayments).set({ journalEntryId: posted.entryId }).where(eq(finPayments.id, pay.id));
    if (data.bankTxnId) await linkBankTxn(tx, { bankTxnId: data.bankTxnId, entryId: posted.entryId, userId: ctx.userId });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.payment_recorded",
        targetType: "fin_payment",
        targetId: pay.id,
        metadata: { direction: "out", amountCents: total, method: data.method, bills: billIds.length, entryNumber: posted.entryNumber, bankTxnId: data.bankTxnId },
      },
      tx
    );
    const reimbursed = new Map<string, number>();
    for (const x of data.applications) {
      const b = byId.get(x.billId)!;
      if (b.kind === "reimbursement" && b.payeeUserId) reimbursed.set(b.payeeUserId, (reimbursed.get(b.payeeUserId) ?? 0) + x.amountCents);
    }
    return { id: pay.id, entryNumber: posted.entryNumber, reimbursed, billForLink: new Map(bills.filter((b) => b.kind === "reimbursement").map((b) => [b.payeeUserId, b.id])) };
  });

  // Tell claimants they were paid (best effort, after commit).
  await Promise.allSettled(
    [...result.reimbursed.entries()].map(async ([userId, cents]) => {
      const [u] = await db.select({ email: users.email, name: users.name, bounced: users.emailBounced }).from(users).where(eq(users.id, userId)).limit(1);
      if (!u || u.bounced) return;
      const built = reimbursementPaidEmail({
        name: u.name,
        amountCents: cents,
        methodLabel: PAYMENT_METHOD_LABELS[data.method],
        dateText: formatDob(data.paymentDate),
        reference: data.reference,
        url: appUrl(`/reimbursements/${result.billForLink.get(userId) ?? ""}`),
      });
      await sendHtmlEmail({ to: u.email, subject: built.subject, html: built.html });
    })
  ).then((rs) => rs.forEach((r) => r.status === "rejected" && console.error("[finance-payments-out] email failed", r.reason)));

  return { id: result.id, entryNumber: result.entryNumber };
}

/** Void a payment (reason required): voids its entry and recomputes paid amounts on its bills. */
export async function voidPayment(ctx: SessionContext, id: string, reason: string): Promise<void> {
  await requireFinance(ctx, "edit");
  const why = voidReasonSchema.parse(reason);
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", "Payment not found.");
  await db.transaction(async (tx) => {
    const [pay] = await tx.select().from(finPayments).where(eq(finPayments.id, id)).for("update").limit(1);
    if (!pay || pay.direction !== "out") throw new DalError("NOT_FOUND", "Payment not found.");
    if (pay.voidedAt) throw new DalError("INVALID", "This payment is already void.");
    const apps = await tx.select().from(finPaymentApplications).where(eq(finPaymentApplications.paymentId, id));
    const billIds = [...new Set(apps.map((a) => a.billId).filter((b): b is string => !!b))];
    if (billIds.length) await tx.select({ id: finBills.id }).from(finBills).where(inArray(finBills.id, billIds)).orderBy(asc(finBills.id)).for("update");
    if (pay.journalEntryId) await voidEntry(tx, { entryId: pay.journalEntryId, userId: ctx.userId, reason: why });
    await tx.update(finPayments).set({ voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: why }).where(eq(finPayments.id, id));
    for (const billId of billIds) {
      const [{ paid }] = await tx
        .select({ paid: sql<number>`coalesce(sum(${finPaymentApplications.amountCents}), 0)::int` })
        .from(finPaymentApplications)
        .innerJoin(finPayments, eq(finPayments.id, finPaymentApplications.paymentId))
        .where(and(eq(finPaymentApplications.billId, billId), isNull(finPayments.voidedAt)));
      const [b] = await tx.select({ total: finBills.totalCents, status: finBills.status }).from(finBills).where(eq(finBills.id, billId)).limit(1);
      if (b && (b.status === "approved" || b.status === "partially_paid" || b.status === "paid")) {
        await tx.update(finBills).set({ paidCents: paid, status: statusFromPaid(b.total, paid) }).where(eq(finBills.id, billId));
      }
    }
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.payment_voided", targetType: "fin_payment", targetId: id, metadata: { reason: why, amountCents: pay.amountCents } },
      tx
    );
  });
}

export interface PaymentRow {
  id: string;
  contactId: string;
  contactName: string;
  paymentDate: IsoDate;
  amountCents: number;
  method: string;
  reference: string | null;
  accountName: string;
  voidedAt: Date | null;
}

export async function listPayments(ctx: SessionContext, opts: { contactId?: string; limit?: number } = {}): Promise<PaymentRow[]> {
  await requireFinance(ctx, "view_all");
  return db
    .select({
      id: finPayments.id,
      contactId: finPayments.contactId,
      contactName: finContacts.displayName,
      paymentDate: finPayments.paymentDate,
      amountCents: finPayments.amountCents,
      method: finPayments.method,
      reference: finPayments.reference,
      accountName: finAccounts.name,
      voidedAt: finPayments.voidedAt,
    })
    .from(finPayments)
    .innerJoin(finContacts, eq(finContacts.id, finPayments.contactId))
    .innerJoin(finAccounts, eq(finAccounts.id, finPayments.accountId))
    .where(and(eq(finPayments.direction, "out"), opts.contactId && UUID_RE.test(opts.contactId) ? eq(finPayments.contactId, opts.contactId) : undefined))
    .orderBy(desc(finPayments.paymentDate), desc(finPayments.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
}

export interface PaymentDetail extends PaymentRow {
  memo: string | null;
  accountCode: string;
  journalEntryId: string | null;
  entryNumber: number | null;
  voidReason: string | null;
  createdByName: string;
  createdAt: Date;
  applications: { billId: string; memo: string; vendorInvoiceNumber: string | null; kind: string; amountCents: number }[];
  canVoid: boolean;
}

export async function getPayment(ctx: SessionContext, id: string): Promise<PaymentDetail> {
  const a = await requireFinance(ctx, "view_all");
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", "Payment not found.");
  const [p] = await db
    .select({
      id: finPayments.id,
      direction: finPayments.direction,
      contactId: finPayments.contactId,
      contactName: finContacts.displayName,
      paymentDate: finPayments.paymentDate,
      amountCents: finPayments.amountCents,
      method: finPayments.method,
      reference: finPayments.reference,
      accountName: finAccounts.name,
      accountCode: finAccounts.code,
      voidedAt: finPayments.voidedAt,
      voidReason: finPayments.voidReason,
      memo: finPayments.memo,
      journalEntryId: finPayments.journalEntryId,
      createdAt: finPayments.createdAt,
      createdByName: users.name,
    })
    .from(finPayments)
    .innerJoin(finContacts, eq(finContacts.id, finPayments.contactId))
    .innerJoin(finAccounts, eq(finAccounts.id, finPayments.accountId))
    .innerJoin(users, eq(users.id, finPayments.createdByUserId))
    .where(eq(finPayments.id, id))
    .limit(1);
  if (!p || p.direction !== "out") throw new DalError("NOT_FOUND", "Payment not found.");
  const [apps, entry] = await Promise.all([
    db
      .select({
        billId: finBills.id,
        memo: finBills.memo,
        vendorInvoiceNumber: finBills.vendorInvoiceNumber,
        kind: finBills.kind,
        amountCents: finPaymentApplications.amountCents,
      })
      .from(finPaymentApplications)
      .innerJoin(finBills, eq(finBills.id, finPaymentApplications.billId))
      .where(eq(finPaymentApplications.paymentId, id)),
    p.journalEntryId
      ? db.select({ n: finJournalEntries.entryNumber }).from(finJournalEntries).where(eq(finJournalEntries.id, p.journalEntryId)).limit(1)
      : Promise.resolve([] as { n: number }[]),
  ]);
  const { direction: _d, ...rest } = p;
  return { ...rest, entryNumber: entry[0]?.n ?? null, applications: apps, canVoid: a.level === "admin" || a.level === "editor" ? !p.voidedAt : false };
}

export interface CheckDetails {
  paymentId: string;
  payeeName: string;
  addressLines: string[];
  amountCents: number;
  amountWords: string;
  date: IsoDate;
  checkNumber: string | null;
  memo: string;
  accountName: string;
  voided: boolean;
  bills: { memo: string; vendorInvoiceNumber: string | null; amountCents: number }[];
}

/** Everything someone needs to write a check by hand (this is not check printing). */
export async function getCheckDetails(ctx: SessionContext, paymentId: string): Promise<CheckDetails> {
  await requireFinance(ctx, "edit");
  const pay = await getPayment(ctx, paymentId);
  const [c] = await db
    .select({
      line1: finContacts.addressLine1,
      line2: finContacts.addressLine2,
      city: finContacts.city,
      state: finContacts.state,
      zip: finContacts.postalCode,
    })
    .from(finContacts)
    .where(eq(finContacts.id, pay.contactId))
    .limit(1);
  const cityLine = [c?.city, [c?.state, c?.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    paymentId: pay.id,
    payeeName: pay.contactName,
    addressLines: [c?.line1, c?.line2, cityLine].filter((x): x is string => !!x),
    amountCents: pay.amountCents,
    amountWords: amountInWords(pay.amountCents),
    date: pay.paymentDate,
    checkNumber: pay.method === "check" ? pay.reference : null,
    memo: pay.memo ?? pay.applications.map((x) => x.memo).join("; ").slice(0, 120),
    accountName: pay.accountName,
    voided: !!pay.voidedAt,
    bills: pay.applications,
  };
}
