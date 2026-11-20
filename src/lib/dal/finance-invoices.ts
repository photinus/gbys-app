import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx, type DbTx } from "@/db";
import {
  finAccounts,
  finContacts,
  finFunds,
  finInvoiceLines,
  finInvoices,
  finJournalEntries,
  finPaymentApplications,
  finPayments,
  finSettings,
  programs,
  users,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sendHtmlEmail } from "@/lib/email";
import { csvCell } from "@/lib/csv";
import { AGING_BUCKETS, AGING_LABELS, buildAging, type AgingReport } from "@/lib/finance/ar-aging";
import { isIsoDate, laToday, type IsoDate } from "@/lib/finance/dates";
import { buildInvoiceEmail } from "@/lib/finance/invoice-email";
import { centsToDecimal } from "@/lib/finance/report-math";
import {
  invoiceInputSchema,
  sendInvoiceSchema,
  voidReasonSchema,
  type InvoiceInput,
} from "@/lib/validation/finance-invoices";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import {
  getAttachment,
  listAttachments,
  readAttachmentBytes,
  softDeleteAttachment,
  storeAttachment,
  type FinAttachmentRow,
} from "./finance-attachments";
import { postEntry, systemAccountId, voidEntry } from "./finance-ledger";
import { getBranding } from "./settings";

/**
 * Finance 2, RB: customer invoices. Reads need org-wide finance access ("view_all"), writes need
 * "edit". Issuing posts Dr Accounts receivable / Cr each line's revenue account (fund, program)
 * as source `invoice`, sourceRef = invoice id. Every journal write runs in a transaction with the
 * invoice row locked.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOTAL_CENTS = 2_000_000_000; // integer column headroom

function assertUuid(id: string, what = "Invoice"): void {
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", `${what} not found.`);
}

export type InvoiceStatus = "draft" | "open" | "partially_paid" | "paid" | "void";

export interface InvoiceListRow {
  id: string;
  number: number;
  contactId: string;
  contactName: string;
  issueDate: IsoDate;
  dueDate: IsoDate | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: InvoiceStatus;
  overdue: boolean;
  sentAt: Date | null;
}

export interface InvoiceListFilter {
  /** A status, or "unpaid" (open + partly paid). */
  status?: string;
  overdue?: boolean;
  contactId?: string;
  limit?: number;
}

function isOverdue(status: string, due: IsoDate | null, issue: IsoDate, today: IsoDate): boolean {
  return (status === "open" || status === "partially_paid") && (due ?? issue) < today;
}

export async function listInvoices(ctx: SessionContext, f: InvoiceListFilter = {}): Promise<InvoiceListRow[]> {
  await requireFinance(ctx, "view_all");
  const today = laToday();
  const conds: SQL[] = [];
  if (f.status === "unpaid") conds.push(inArray(finInvoices.status, ["open", "partially_paid"]));
  else if (f.status && ["draft", "open", "partially_paid", "paid", "void"].includes(f.status)) {
    conds.push(eq(finInvoices.status, f.status as InvoiceStatus));
  }
  if (f.overdue) {
    conds.push(inArray(finInvoices.status, ["open", "partially_paid"]));
    conds.push(sql`coalesce(${finInvoices.dueDate}, ${finInvoices.issueDate}) < ${today}::date`);
  }
  if (f.contactId && UUID_RE.test(f.contactId)) conds.push(eq(finInvoices.contactId, f.contactId));
  const rows = await db
    .select({
      id: finInvoices.id,
      number: finInvoices.number,
      contactId: finInvoices.contactId,
      contactName: finContacts.displayName,
      issueDate: finInvoices.issueDate,
      dueDate: finInvoices.dueDate,
      totalCents: finInvoices.totalCents,
      paidCents: finInvoices.paidCents,
      status: finInvoices.status,
      sentAt: finInvoices.sentAt,
    })
    .from(finInvoices)
    .innerJoin(finContacts, eq(finContacts.id, finInvoices.contactId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(finInvoices.number))
    .limit(Math.min(Math.max(f.limit ?? 300, 1), 1000));
  return rows.map((r) => ({
    ...r,
    balanceCents: r.status === "void" ? 0 : r.totalCents - r.paidCents,
    overdue: isOverdue(r.status, r.dueDate, r.issueDate, today),
  }));
}

export interface InvoiceSummary {
  /** Outstanding on open + partly paid invoices. */
  outstandingCents: number;
  overdueCents: number;
  openCount: number;
  overdueCount: number;
}

export async function getInvoiceSummary(ctx: SessionContext): Promise<InvoiceSummary> {
  await requireFinance(ctx, "view_all");
  const today = laToday();
  const r = await db.execute<{ out: string; od: string; n: string; odn: string }>(sql`
    select coalesce(sum(total_cents - paid_cents), 0)::text as out,
           coalesce(sum(total_cents - paid_cents) filter (where coalesce(due_date, issue_date) < ${today}::date), 0)::text as od,
           count(*)::text as n,
           (count(*) filter (where coalesce(due_date, issue_date) < ${today}::date))::text as odn
    from fin_invoices where status in ('open', 'partially_paid')
  `);
  const row = r.rows[0];
  return { outstandingCents: Number(row.out), overdueCents: Number(row.od), openCount: Number(row.n), overdueCount: Number(row.odn) };
}

export interface InvoiceLineDetail {
  id: string;
  lineNo: number;
  description: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  fundId: string | null;
  fundName: string | null;
  programId: string | null;
  programName: string | null;
  amountCents: number;
}

export interface InvoicePaymentRow {
  paymentId: string;
  paymentDate: IsoDate;
  method: string;
  reference: string | null;
  appliedCents: number;
  depositAccountName: string;
  voidedAt: Date | null;
  voidReason: string | null;
}

export interface InvoiceDetail {
  id: string;
  number: number;
  status: InvoiceStatus;
  contactId: string;
  contact: {
    name: string;
    email: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  issueDate: IsoDate;
  dueDate: IsoDate | null;
  memo: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  overdue: boolean;
  journalEntryId: string | null;
  journalEntryNumber: number | null;
  sentAt: Date | null;
  sentToEmail: string | null;
  createdAt: Date;
  createdByName: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  lines: InvoiceLineDetail[];
  payments: InvoicePaymentRow[];
  /** Finance settings: how customers should pay (shown on the print view and in the email). */
  paymentInstructions: string | null;
}

export async function getInvoice(ctx: SessionContext, id: string): Promise<InvoiceDetail> {
  await requireFinance(ctx, "view_all");
  assertUuid(id);
  const [inv] = await db
    .select({
      i: finInvoices,
      c: finContacts,
      entryNumber: finJournalEntries.entryNumber,
      createdByName: users.name,
    })
    .from(finInvoices)
    .innerJoin(finContacts, eq(finContacts.id, finInvoices.contactId))
    .leftJoin(finJournalEntries, eq(finJournalEntries.id, finInvoices.journalEntryId))
    .leftJoin(users, eq(users.id, finInvoices.createdByUserId))
    .where(eq(finInvoices.id, id))
    .limit(1);
  if (!inv) throw new DalError("NOT_FOUND", "Invoice not found.");
  const [lines, pays, settings] = await Promise.all([
    db
      .select({
        id: finInvoiceLines.id,
        lineNo: finInvoiceLines.lineNo,
        description: finInvoiceLines.description,
        accountId: finInvoiceLines.accountId,
        accountCode: finAccounts.code,
        accountName: finAccounts.name,
        fundId: finInvoiceLines.fundId,
        fundName: finFunds.name,
        programId: finInvoiceLines.programId,
        programName: programs.name,
        amountCents: finInvoiceLines.amountCents,
      })
      .from(finInvoiceLines)
      .innerJoin(finAccounts, eq(finAccounts.id, finInvoiceLines.accountId))
      .leftJoin(finFunds, eq(finFunds.id, finInvoiceLines.fundId))
      .leftJoin(programs, eq(programs.id, finInvoiceLines.programId))
      .where(eq(finInvoiceLines.invoiceId, id))
      .orderBy(asc(finInvoiceLines.lineNo)),
    db
      .select({
        paymentId: finPayments.id,
        paymentDate: finPayments.paymentDate,
        method: finPayments.method,
        reference: finPayments.reference,
        appliedCents: finPaymentApplications.amountCents,
        depositAccountName: finAccounts.name,
        voidedAt: finPayments.voidedAt,
        voidReason: finPayments.voidReason,
      })
      .from(finPaymentApplications)
      .innerJoin(finPayments, eq(finPayments.id, finPaymentApplications.paymentId))
      .innerJoin(finAccounts, eq(finAccounts.id, finPayments.accountId))
      .where(eq(finPaymentApplications.invoiceId, id))
      .orderBy(asc(finPayments.paymentDate), asc(finPayments.createdAt)),
    db.select({ i: finSettings.invoicePaymentInstructions }).from(finSettings).where(eq(finSettings.id, 1)).limit(1),
  ]);
  const i = inv.i;
  return {
    id: i.id,
    number: i.number,
    status: i.status,
    contactId: i.contactId,
    contact: {
      name: inv.c.displayName,
      email: inv.c.email,
      addressLine1: inv.c.addressLine1,
      addressLine2: inv.c.addressLine2,
      city: inv.c.city,
      state: inv.c.state,
      postalCode: inv.c.postalCode,
    },
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    memo: i.memo,
    totalCents: i.totalCents,
    paidCents: i.paidCents,
    balanceCents: i.status === "void" ? 0 : i.totalCents - i.paidCents,
    overdue: isOverdue(i.status, i.dueDate, i.issueDate, laToday()),
    journalEntryId: i.journalEntryId,
    journalEntryNumber: inv.entryNumber,
    sentAt: i.sentAt,
    sentToEmail: i.sentToEmail,
    createdAt: i.createdAt,
    createdByName: inv.createdByName,
    voidedAt: i.voidedAt,
    voidReason: i.voidReason,
    lines,
    payments: pays,
    paymentInstructions: settings[0]?.i?.trim() || null,
  };
}

// ---- Validation helpers ------------------------------------------------------

async function assertCustomer(tx: DbOrTx, contactId: string): Promise<{ name: string; email: string | null }> {
  const [c] = await tx
    .select({ name: finContacts.displayName, email: finContacts.email, isCustomer: finContacts.isCustomer, isActive: finContacts.isActive })
    .from(finContacts)
    .where(eq(finContacts.id, contactId))
    .limit(1);
  if (!c) throw new DalError("INVALID", "Pick a customer.");
  if (!c.isCustomer) throw new DalError("INVALID", `${c.name} isn't set up as a customer. Edit the contact and add the customer role first.`);
  if (!c.isActive) throw new DalError("INVALID", `${c.name} is inactive.`);
  return { name: c.name, email: c.email };
}

async function assertRevenueAccounts(tx: DbOrTx, accountIds: string[]): Promise<void> {
  const ids = [...new Set(accountIds)];
  const rows = await tx
    .select({ id: finAccounts.id, type: finAccounts.type, isActive: finAccounts.isActive, name: finAccounts.name })
    .from(finAccounts)
    .where(inArray(finAccounts.id, ids));
  if (rows.length !== ids.length) throw new DalError("INVALID", "Unknown account on an invoice line.");
  const bad = rows.find((r) => r.type !== "revenue");
  if (bad) throw new DalError("INVALID", `“${bad.name}” isn't a revenue account. Invoice lines must use a money-in category.`);
  const inactive = rows.find((r) => !r.isActive);
  if (inactive) throw new DalError("INVALID", `Account “${inactive.name}” is inactive.`);
}

async function assertProgramsExist(tx: DbOrTx, programIds: (string | null)[]): Promise<void> {
  const ids = [...new Set(programIds.filter((p): p is string => !!p))];
  if (ids.length === 0) return;
  const rows = await tx.select({ id: programs.id }).from(programs).where(and(inArray(programs.id, ids), isNull(programs.deletedAt)));
  if (rows.length !== ids.length) throw new DalError("INVALID", "Unknown program on an invoice line.");
}

/** The shared program of all lines (null when mixed or none): stored on the header for filtering. */
function headerProgram(lines: { programId: string | null }[]): string | null {
  const set = new Set(lines.map((l) => l.programId));
  return set.size === 1 ? ([...set][0] ?? null) : null;
}

async function lockInvoice(tx: DbTx, id: string) {
  assertUuid(id);
  const [inv] = await tx.select().from(finInvoices).where(eq(finInvoices.id, id)).for("update").limit(1);
  if (!inv) throw new DalError("NOT_FOUND", "Invoice not found.");
  return inv;
}

function prepareLines(data: ReturnType<typeof invoiceInputSchema.parse>) {
  const total = data.lines.reduce((s, l) => s + l.amountCents, 0);
  if (total > MAX_TOTAL_CENTS) throw new DalError("INVALID", "The invoice total is too large.");
  return total;
}

// ---- Draft create / edit -----------------------------------------------------

export async function createInvoiceDraft(ctx: SessionContext, input: InvoiceInput): Promise<{ id: string; number: number }> {
  await requireFinance(ctx, "edit");
  const data = invoiceInputSchema.parse(input);
  const total = prepareLines(data);
  return db.transaction(async (tx) => {
    const customer = await assertCustomer(tx, data.contactId);
    await assertRevenueAccounts(tx, data.lines.map((l) => l.accountId));
    await assertProgramsExist(tx, data.lines.map((l) => l.programId));
    const seq = await tx.execute<{ n: number }>(sql`select nextval('fin_invoice_number_seq')::int as n`);
    const number = Number(seq.rows[0].n);
    const dueDate = data.dueDate;
    const [inv] = await tx
      .insert(finInvoices)
      .values({
        number,
        contactId: data.contactId,
        programId: headerProgram(data.lines),
        issueDate: data.issueDate,
        dueDate,
        memo: data.memo,
        totalCents: total,
        status: "draft",
        createdByUserId: ctx.userId,
      })
      .returning({ id: finInvoices.id });
    await tx.insert(finInvoiceLines).values(
      data.lines.map((l, i) => ({
        invoiceId: inv.id,
        lineNo: i + 1,
        accountId: l.accountId,
        fundId: l.fundId,
        programId: l.programId,
        amountCents: l.amountCents,
        description: l.description,
      }))
    );
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.invoice_created",
        targetType: "fin_invoice",
        targetId: inv.id,
        metadata: { number, customer: customer.name, totalCents: total },
      },
      tx
    );
    return { id: inv.id, number };
  });
}

export async function updateInvoiceDraft(ctx: SessionContext, id: string, input: InvoiceInput): Promise<void> {
  await requireFinance(ctx, "edit");
  const data = invoiceInputSchema.parse(input);
  const total = prepareLines(data);
  await db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== "draft") {
      throw new DalError("INVALID", "This invoice has already been issued, so it can't be edited. Void it and create a new one if something is wrong.");
    }
    await assertCustomer(tx, data.contactId);
    await assertRevenueAccounts(tx, data.lines.map((l) => l.accountId));
    await assertProgramsExist(tx, data.lines.map((l) => l.programId));
    await tx.delete(finInvoiceLines).where(eq(finInvoiceLines.invoiceId, id));
    await tx.insert(finInvoiceLines).values(
      data.lines.map((l, i) => ({
        invoiceId: id,
        lineNo: i + 1,
        accountId: l.accountId,
        fundId: l.fundId,
        programId: l.programId,
        amountCents: l.amountCents,
        description: l.description,
      }))
    );
    await tx
      .update(finInvoices)
      .set({
        contactId: data.contactId,
        programId: headerProgram(data.lines),
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        memo: data.memo,
        totalCents: total,
      })
      .where(eq(finInvoices.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.invoice_updated",
        targetType: "fin_invoice",
        targetId: id,
        metadata: { number: inv.number, totalCents: total, from: inv.totalCents },
      },
      tx
    );
  });
}

// ---- Issue ---------------------------------------------------------------------

/** Post the invoice to the books (Dr Accounts receivable / Cr revenue) and mark it open. */
export async function issueInvoice(ctx: SessionContext, id: string): Promise<{ entryId: string; entryNumber: number }> {
  await requireFinance(ctx, "edit");
  return db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status !== "draft") throw new DalError("INVALID", "This invoice has already been issued.");
    const lines = await tx.select().from(finInvoiceLines).where(eq(finInvoiceLines.invoiceId, id)).orderBy(asc(finInvoiceLines.lineNo));
    if (lines.length === 0 || inv.totalCents <= 0) throw new DalError("INVALID", "Add at least one line with an amount before issuing.");
    const customer = await assertCustomer(tx, inv.contactId);
    await assertRevenueAccounts(tx, lines.map((l) => l.accountId));
    const ar = await systemAccountId(tx, "accounts_receivable");
    const posted = await postEntry(tx, {
      entryDate: inv.issueDate,
      memo: `Invoice #${inv.number} to ${customer.name}`,
      source: "invoice",
      sourceRef: inv.id,
      createdByUserId: ctx.userId,
      lines: [
        { accountId: ar, debitCents: inv.totalCents, description: `Invoice #${inv.number}` },
        ...lines.map((l) => ({
          accountId: l.accountId,
          fundId: l.fundId,
          programId: l.programId,
          creditCents: l.amountCents,
          description: l.description,
        })),
      ],
    });
    await tx.update(finInvoices).set({ status: "open", journalEntryId: posted.entryId }).where(eq(finInvoices.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.invoice_issued",
        targetType: "fin_invoice",
        targetId: id,
        metadata: { number: inv.number, totalCents: inv.totalCents, entryNumber: posted.entryNumber },
      },
      tx
    );
    return { entryId: posted.entryId, entryNumber: posted.entryNumber };
  });
}

// ---- Send ----------------------------------------------------------------------

function appBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Email the invoice as HTML (org name, logo, number, dates, lines, total, balance due and the
 * payment instructions from Finance settings). Can be re-sent; each send updates sentAt /
 * sentToEmail. The recipient defaults to the customer's email.
 */
export async function sendInvoice(ctx: SessionContext, input: { id: string; toEmail?: string | null }): Promise<{ sentTo: string }> {
  await requireFinance(ctx, "edit");
  const data = sendInvoiceSchema.parse(input);
  const inv = await getInvoice(ctx, data.id);
  if (inv.status === "draft") throw new DalError("INVALID", "Issue the invoice before sending it.");
  if (inv.status === "void") throw new DalError("INVALID", "A voided invoice can't be sent.");
  const to = data.toEmail ?? inv.contact.email;
  if (!to) throw new DalError("INVALID", "This customer has no email address. Enter one to send the invoice.");

  const branding = await getBranding();
  const email = buildInvoiceEmail({
    orgName: branding.orgName,
    legalDesignation: branding.legalDesignation,
    ein: branding.ein,
    supportEmail: branding.supportEmail,
    logoUrl: branding.logoUrl ? `${appBaseUrl()}${branding.logoUrl}` : null,
    number: inv.number,
    customerName: inv.contact.name,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    memo: inv.memo,
    lines: inv.lines.map((l) => ({ description: l.description, amountCents: l.amountCents })),
    totalCents: inv.totalCents,
    paidCents: inv.paidCents,
    paymentInstructions: inv.paymentInstructions,
  });
  // Send first (no locks held): sentAt must only be recorded for an email that actually went out.
  await sendHtmlEmail({ to, subject: email.subject, html: email.html });
  await db.transaction(async (tx) => {
    await tx.update(finInvoices).set({ sentAt: new Date(), sentToEmail: to }).where(eq(finInvoices.id, inv.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.invoice_sent",
        targetType: "fin_invoice",
        targetId: inv.id,
        metadata: { number: inv.number, to, resend: inv.sentAt !== null },
      },
      tx
    );
  });
  return { sentTo: to };
}

// ---- Void ----------------------------------------------------------------------

/**
 * Void an invoice with a reason. A draft just becomes void. An issued invoice has its journal
 * entry voided too. Refused while any live (non-voided) payment is applied to it.
 */
export async function voidInvoice(ctx: SessionContext, input: { id: string; reason: string }): Promise<void> {
  await requireFinance(ctx, "edit");
  const data = voidReasonSchema.parse(input);
  await db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, data.id);
    if (inv.status === "void") throw new DalError("INVALID", "This invoice is already void.");
    const live = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from fin_payment_applications a
      join fin_payments p on p.id = a.payment_id
      where a.invoice_id = ${inv.id}::uuid and p.voided_at is null
    `);
    if (inv.paidCents > 0 || Number(live.rows[0].n) > 0) {
      throw new DalError("INVALID", "This invoice has payments recorded against it. Void those payments first, then void the invoice.");
    }
    if (inv.journalEntryId) {
      await voidEntry(tx, { entryId: inv.journalEntryId, userId: ctx.userId, reason: `Invoice #${inv.number} voided: ${data.reason}` });
    }
    await tx
      .update(finInvoices)
      .set({ status: "void", voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: data.reason })
      .where(eq(finInvoices.id, inv.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.invoice_voided",
        targetType: "fin_invoice",
        targetId: inv.id,
        metadata: { number: inv.number, reason: data.reason, wasIssued: !!inv.journalEntryId },
      },
      tx
    );
  });
}

// ---- Attachments ---------------------------------------------------------------

async function assertInvoiceExists(tx: DbOrTx, id: string): Promise<{ number: number }> {
  assertUuid(id);
  const [inv] = await tx.select({ number: finInvoices.number }).from(finInvoices).where(eq(finInvoices.id, id)).limit(1);
  if (!inv) throw new DalError("NOT_FOUND", "Invoice not found.");
  return inv;
}

export async function listInvoiceAttachments(ctx: SessionContext, invoiceId: string): Promise<FinAttachmentRow[]> {
  await requireFinance(ctx, "view_all");
  await assertInvoiceExists(db, invoiceId);
  return listAttachments(db, "invoice", invoiceId);
}

export async function addInvoiceAttachment(ctx: SessionContext, invoiceId: string, file: File): Promise<{ id: string }> {
  await requireFinance(ctx, "edit");
  return db.transaction(async (tx) => {
    const inv = await assertInvoiceExists(tx, invoiceId);
    const row = await storeAttachment(tx, { ownerType: "invoice", ownerId: invoiceId, file, userId: ctx.userId });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.attachment_added",
        targetType: "fin_attachment",
        targetId: row.id,
        metadata: { owner: "invoice", ownerId: invoiceId, number: inv.number, fileName: file.name },
      },
      tx
    );
    return row;
  });
}

export async function removeInvoiceAttachment(ctx: SessionContext, invoiceId: string, attachmentId: string): Promise<void> {
  await requireFinance(ctx, "edit");
  await db.transaction(async (tx) => {
    await assertInvoiceExists(tx, invoiceId);
    const att = await getAttachment(attachmentId, tx);
    if (!att || att.ownerType !== "invoice" || att.ownerId !== invoiceId) throw new DalError("NOT_FOUND", "Attachment not found.");
    await softDeleteAttachment(tx, att.id, ctx.userId);
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.attachment_removed",
        targetType: "fin_attachment",
        targetId: att.id,
        metadata: { owner: "invoice", ownerId: invoiceId, fileName: att.fileName },
      },
      tx
    );
  });
}

/** Authorized download of an invoice attachment (for the route handler). */
export async function getInvoiceAttachmentFile(ctx: SessionContext, invoiceId: string, attachmentId: string) {
  await requireFinance(ctx, "view_all");
  const att = await getAttachment(attachmentId);
  if (!att || att.ownerType !== "invoice" || att.ownerId !== invoiceId) throw new DalError("NOT_FOUND", "Attachment not found.");
  const obj = await readAttachmentBytes(att.objectKey);
  return { fileName: att.fileName, contentType: att.contentType, body: obj };
}

// ---- A/R aging -------------------------------------------------------------------

/**
 * Outstanding invoices as of a date ("view_all"): issued on or before the date, not yet voided
 * as of it, balance = total minus payments dated on or before it that were still live then.
 */
export async function getArAging(ctx: SessionContext, asOfInput?: string | null): Promise<AgingReport> {
  await requireFinance(ctx, "view_all");
  const asOf: IsoDate = asOfInput && isIsoDate(asOfInput) ? asOfInput : laToday();
  const rows = await db.execute<{
    id: string;
    number: number;
    contact_id: string;
    name: string;
    issue_date: string;
    due_date: string | null;
    total: string;
    paid: string;
  }>(sql`
    select i.id, i.number, i.contact_id, c.display_name as name, i.issue_date::text as issue_date, i.due_date::text as due_date,
           i.total_cents::text as total,
           coalesce((
             select sum(a.amount_cents) from fin_payment_applications a
             join fin_payments p on p.id = a.payment_id
             where a.invoice_id = i.id and p.payment_date <= ${asOf}::date
               and (p.voided_at is null or (p.voided_at at time zone 'America/Los_Angeles')::date > ${asOf}::date)
           ), 0)::text as paid
    from fin_invoices i
    join fin_contacts c on c.id = i.contact_id
    where i.journal_entry_id is not null
      and i.issue_date <= ${asOf}::date
      and (i.voided_at is null or (i.voided_at at time zone 'America/Los_Angeles')::date > ${asOf}::date)
  `);
  return buildAging(
    rows.rows.map((r) => ({
      invoiceId: r.id,
      number: Number(r.number),
      contactId: r.contact_id,
      contactName: r.name,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      balanceCents: Number(r.total) - Number(r.paid),
    })),
    asOf
  );
}

export async function exportArAgingCsv(ctx: SessionContext, asOf?: string | null): Promise<{ csv: string; filename: string; rowCount: number }> {
  const r = await getArAging(ctx, asOf);
  const head = ["Customer", "Invoice #", "Issue date", "Due date", "Days past due", ...AGING_BUCKETS.map((b) => AGING_LABELS[b]), "Balance"];
  const money = (c: number) => centsToDecimal(c);
  const lines: string[] = [head.map((h) => csvCell(h)).join(",")];
  let rowCount = 0;
  for (const g of r.groups) {
    for (const row of g.rows) {
      rowCount++;
      lines.push(
        [
          csvCell(g.contactName),
          csvCell(row.number),
          csvCell(row.issueDate),
          csvCell(row.dueDate ?? ""),
          csvCell(Math.max(row.daysPastDue, 0)),
          ...AGING_BUCKETS.map((b) => (row.bucket === b ? money(row.balanceCents) : "0.00")),
          money(row.balanceCents),
        ].join(",")
      );
    }
    lines.push(
      [csvCell(`${g.contactName} total`), "", "", "", "", ...AGING_BUCKETS.map((b) => money(g.totals[b])), money(g.totals.total)].join(",")
    );
  }
  lines.push(["Total", "", "", "", "", ...AGING_BUCKETS.map((b) => money(r.totals[b])), money(r.totals.total)].join(","));
  const filename = `finance-ar-aging-as-of-${r.asOf}.csv`;
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.report_exported",
    targetType: "fin_report",
    targetId: "ar-aging",
    metadata: { report: "ar-aging", period: `as-of-${r.asOf}`, rowCount, format: "csv" },
  });
  return { csv: "﻿" + lines.join("\r\n") + "\r\n", filename, rowCount };
}
