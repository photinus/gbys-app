import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx, type DbTx } from "@/db";
import {
  finAccounts,
  finBillApprovals,
  finBillLines,
  finBills,
  finContacts,
  finFunds,
  finJournalEntries,
  finPaymentApplications,
  finPayments,
  finRoles,
  finSettings,
  programs,
  users,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sendHtmlEmail } from "@/lib/email";
import { addDays, laToday, type IsoDate } from "@/lib/finance/dates";
import {
  APPROVER_REFUSAL_TEXT,
  approvalsRequiredFor,
  approverRefusal,
  tallyApprovals,
} from "@/lib/finance/approvals";
import {
  appUrl,
  approvalNeededEmail,
  billRejectedEmail,
  reimbursementDecisionEmail,
  type BuiltEmail,
} from "@/lib/finance/payables-email";
import { formatDob } from "@/lib/format";
import {
  billInputSchema,
  decisionSchema,
  recategorizeSchema,
  reimbursementInputSchema,
  voidReasonSchema,
  type BillInput,
  type DecisionInput,
  type ReimbursementInput,
} from "@/lib/validation/finance-bills";
import { DalError, type SessionContext } from "./context";
import {
  canApproveBills,
  canEditBooks,
  canSubmitBillFor,
  canViewBillsFor,
  getFinanceAccess,
  type FinanceAccess,
} from "./finance-access";
import {
  getAttachment,
  listAttachments,
  readAttachmentBytes,
  softDeleteAttachment,
  storeAttachment,
  type FinAttachmentRow,
} from "./finance-attachments";
import { createContact, ensureContactForUser } from "./finance-contacts";
import { generalFundId, getLockDate, postEntry, systemAccountId, voidEntry } from "./finance-ledger";

/**
 * Bills and reimbursements (Finance 2, PB).
 *
 * Lifecycle: draft -> pending_approval -> approved (posted) -> partially_paid / paid, or
 * rejected (editable, resubmit = a fresh approval round) or void.
 * Every write runs in a transaction that locks the bill row (`for update`), so two
 * approvers approving at once cannot post twice. Journal writes use postEntry/voidEntry only.
 */

export type BillStatus = (typeof finBills.status.enumValues)[number];
export type BillKind = "bill" | "reimbursement";

/** Status filter groups used by the payables list. */
export type BillGroup = "all" | "attention" | "unpaid" | "paid" | "drafts" | "void";
const GROUP_STATUSES: Record<Exclude<BillGroup, "all">, BillStatus[]> = {
  attention: ["pending_approval"],
  unpaid: ["approved", "partially_paid"],
  paid: ["paid"],
  drafts: ["draft", "rejected"],
  void: ["void"],
};

export interface BillRow {
  id: string;
  kind: BillKind;
  contactId: string;
  contactName: string;
  vendorInvoiceNumber: string | null;
  programId: string | null;
  programName: string | null;
  billDate: IsoDate;
  dueDate: IsoDate | null;
  memo: string;
  totalCents: number;
  paidCents: number;
  status: BillStatus;
  approvalsRequired: number;
  submittedAt: Date | null;
  createdAt: Date;
  payeeUserId: string | null;
}

export interface BillLineRow {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  fundId: string | null;
  fundName: string;
  programId: string | null;
  programName: string | null;
  amountCents: number;
  description: string | null;
}

export interface BillApprovalRow {
  id: string;
  userId: string;
  userName: string;
  decision: "approve" | "reject";
  note: string | null;
  createdAt: Date;
  /** True for decisions of the current submission round. */
  current: boolean;
}

export interface BillPaymentRow {
  paymentId: string;
  paymentDate: IsoDate;
  method: string;
  reference: string | null;
  amountCents: number;
  voidedAt: Date | null;
}

export interface BillViewer {
  isClaimant: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canRecategorize: boolean;
  canApprove: boolean;
  /** Plain-language reason an approver (org-wide editor) can't decide on this one. */
  approveBlockedReason: string | null;
  canVoid: boolean;
  canPay: boolean;
  canAttach: boolean;
  /** Claimant may withdraw a pending claim. */
  canWithdraw: boolean;
}

export interface BillDetail extends BillRow {
  contactEmail: string | null;
  contactUserId: string | null;
  createdByUserId: string;
  createdByName: string;
  submittedByUserId: string | null;
  submittedByName: string | null;
  rejectedReason: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  journalEntryId: string | null;
  entryNumber: number | null;
  lines: BillLineRow[];
  approvals: BillApprovalRow[];
  payments: BillPaymentRow[];
  attachments: FinAttachmentRow[];
  viewer: BillViewer;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const NO_PERMISSION = "You do not have permission to do that.";

function fmtDay(d: IsoDate): string {
  return formatDob(d);
}

// ---------------------------------------------------------------------------
// Options (pickers)
// ---------------------------------------------------------------------------

export interface BillOptions {
  accounts: { id: string; code: string; name: string; type: string }[];
  funds: { id: string; name: string; restriction: string }[];
  programs: { id: string; name: string }[];
  vendors: { id: string; displayName: string; defaultAccountId: string | null }[];
  generalFundId: string;
  /** Org-wide bookkeepers may leave the program blank; program editors must pick one of theirs. */
  orgWide: boolean;
}

function editorProgramIds(a: FinanceAccess): string[] {
  return [...new Set(a.programs.filter((p) => p.role === "editor").map((p) => p.programId))];
}

/** Everything the bill form needs. Org-wide bookkeepers and program editors only. */
export async function getBillOptions(ctx: SessionContext): Promise<BillOptions> {
  const a = await getFinanceAccess(ctx);
  const orgWide = canEditBooks(a);
  const editorPrograms = editorProgramIds(a);
  if (!orgWide && editorPrograms.length === 0) throw new DalError("FORBIDDEN", NO_PERMISSION);
  const [accts, funds, progs, vendors, general] = await Promise.all([
    db
      .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, type: finAccounts.type })
      .from(finAccounts)
      .where(
        and(
          eq(finAccounts.isActive, true),
          eq(finAccounts.isBank, false),
          isNull(finAccounts.systemKey),
          inArray(finAccounts.type, ["expense", "asset"])
        )
      )
      .orderBy(asc(finAccounts.code)),
    db
      .select({ id: finFunds.id, name: finFunds.name, restriction: finFunds.restriction })
      .from(finFunds)
      .where(eq(finFunds.isActive, true))
      .orderBy(asc(finFunds.name)),
    db
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(and(isNull(programs.deletedAt), orgWide ? undefined : inArray(programs.id, editorPrograms)))
      .orderBy(asc(programs.name)),
    db
      .select({ id: finContacts.id, displayName: finContacts.displayName, defaultAccountId: finContacts.defaultAccountId })
      .from(finContacts)
      .where(and(eq(finContacts.isVendor, true), eq(finContacts.isActive, true)))
      .orderBy(asc(finContacts.displayName))
      .limit(1000),
    generalFundId(db),
  ]);
  return { accounts: accts, funds, programs: progs, vendors, generalFundId: general, orgWide };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const rowCols = {
  id: finBills.id,
  kind: finBills.kind,
  contactId: finBills.contactId,
  contactName: finContacts.displayName,
  vendorInvoiceNumber: finBills.vendorInvoiceNumber,
  programId: finBills.programId,
  programName: programs.name,
  billDate: finBills.billDate,
  dueDate: finBills.dueDate,
  memo: finBills.memo,
  totalCents: finBills.totalCents,
  paidCents: finBills.paidCents,
  status: finBills.status,
  approvalsRequired: finBills.approvalsRequired,
  submittedAt: finBills.submittedAt,
  createdAt: finBills.createdAt,
  payeeUserId: finBills.payeeUserId,
};

function baseRows(tx: DbOrTx = db) {
  return tx
    .select(rowCols)
    .from(finBills)
    .innerJoin(finContacts, eq(finContacts.id, finBills.contactId))
    .leftJoin(programs, eq(programs.id, finBills.programId));
}

/** SQL restricting bills to those the user may read (org-wide: all; program users: their programs). */
function readScope(a: FinanceAccess): SQL | undefined {
  if (a.level !== null) return undefined;
  const ids = [...new Set(a.programs.map((p) => p.programId))];
  if (ids.length === 0) return sql`false`;
  return inArray(finBills.programId, ids);
}

export interface ListBillsFilter {
  group?: BillGroup;
  q?: string;
  contactId?: string;
  kind?: BillKind;
  /** Only unpaid bills past their due date. */
  overdue?: boolean;
  limit?: number;
}

export async function listBills(ctx: SessionContext, f: ListBillsFilter = {}): Promise<BillRow[]> {
  const a = await getFinanceAccess(ctx);
  if (a.level === null && a.programs.length === 0) throw new DalError("FORBIDDEN", NO_PERMISSION);
  const conds: (SQL | undefined)[] = [readScope(a)];
  if (f.group && f.group !== "all") conds.push(inArray(finBills.status, GROUP_STATUSES[f.group]));
  if (f.kind) conds.push(eq(finBills.kind, f.kind));
  if (f.contactId && UUID_RE.test(f.contactId)) conds.push(eq(finBills.contactId, f.contactId));
  if (f.overdue) {
    conds.push(inArray(finBills.status, ["approved", "partially_paid"]));
    conds.push(sql`coalesce(${finBills.dueDate}, ${finBills.billDate}) < ${laToday()}::date`);
  }
  const q = f.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(finContacts.displayName, like), ilike(finBills.memo, like), ilike(finBills.vendorInvoiceNumber, like)));
  }
  return baseRows()
    .where(and(...conds))
    .orderBy(desc(finBills.createdAt))
    .limit(Math.min(Math.max(f.limit ?? 300, 1), 1000));
}

export async function billGroupCounts(ctx: SessionContext): Promise<Record<BillGroup, number>> {
  const a = await getFinanceAccess(ctx);
  if (a.level === null && a.programs.length === 0) throw new DalError("FORBIDDEN", NO_PERMISSION);
  const rows = await db
    .select({ status: finBills.status, n: sql<number>`count(*)::int` })
    .from(finBills)
    .where(readScope(a))
    .groupBy(finBills.status);
  const out: Record<BillGroup, number> = { all: 0, attention: 0, unpaid: 0, paid: 0, drafts: 0, void: 0 };
  for (const r of rows) {
    out.all += r.n;
    for (const [g, sts] of Object.entries(GROUP_STATUSES)) if (sts.includes(r.status)) out[g as BillGroup] += r.n;
  }
  return out;
}

function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", "Bill not found.");
}

async function loadBillDetail(tx: DbOrTx, id: string): Promise<Omit<BillDetail, "viewer"> | null> {
  const [bill] = await tx
    .select({
      ...rowCols,
      contactEmail: finContacts.email,
      contactUserId: finContacts.userId,
      createdByUserId: finBills.createdByUserId,
      submittedByUserId: finBills.submittedByUserId,
      rejectedReason: finBills.rejectedReason,
      voidedAt: finBills.voidedAt,
      voidReason: finBills.voidReason,
      journalEntryId: finBills.journalEntryId,
    })
    .from(finBills)
    .innerJoin(finContacts, eq(finContacts.id, finBills.contactId))
    .leftJoin(programs, eq(programs.id, finBills.programId))
    .where(eq(finBills.id, id))
    .limit(1);
  if (!bill) return null;

  const [lines, approvalRows, paymentRows, attachments, names, entry] = await Promise.all([
    tx
      .select({
        id: finBillLines.id,
        lineNo: finBillLines.lineNo,
        accountId: finBillLines.accountId,
        accountCode: finAccounts.code,
        accountName: finAccounts.name,
        fundId: finBillLines.fundId,
        fundName: finFunds.name,
        programId: finBillLines.programId,
        programName: programs.name,
        amountCents: finBillLines.amountCents,
        description: finBillLines.description,
      })
      .from(finBillLines)
      .innerJoin(finAccounts, eq(finAccounts.id, finBillLines.accountId))
      .leftJoin(finFunds, eq(finFunds.id, finBillLines.fundId))
      .leftJoin(programs, eq(programs.id, finBillLines.programId))
      .where(eq(finBillLines.billId, id))
      .orderBy(asc(finBillLines.lineNo)),
    tx
      .select({
        id: finBillApprovals.id,
        userId: finBillApprovals.userId,
        userName: users.name,
        decision: finBillApprovals.decision,
        note: finBillApprovals.note,
        createdAt: finBillApprovals.createdAt,
        submittedAt: finBillApprovals.submittedAt,
      })
      .from(finBillApprovals)
      .innerJoin(users, eq(users.id, finBillApprovals.userId))
      .where(eq(finBillApprovals.billId, id))
      .orderBy(asc(finBillApprovals.createdAt)),
    tx
      .select({
        paymentId: finPayments.id,
        paymentDate: finPayments.paymentDate,
        method: finPayments.method,
        reference: finPayments.reference,
        amountCents: finPaymentApplications.amountCents,
        voidedAt: finPayments.voidedAt,
      })
      .from(finPaymentApplications)
      .innerJoin(finPayments, eq(finPayments.id, finPaymentApplications.paymentId))
      .where(eq(finPaymentApplications.billId, id))
      .orderBy(asc(finPayments.paymentDate), asc(finPayments.createdAt)),
    listAttachments(tx, "bill", id),
    tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [bill.createdByUserId, ...(bill.submittedByUserId ? [bill.submittedByUserId] : [])])),
    bill.journalEntryId
      ? tx
          .select({ n: finJournalEntries.entryNumber })
          .from(finJournalEntries)
          .where(eq(finJournalEntries.id, bill.journalEntryId))
          .limit(1)
      : Promise.resolve([] as { n: number }[]),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const submittedKey = bill.submittedAt?.getTime();
  return {
    ...bill,
    createdByName: nameOf.get(bill.createdByUserId) ?? "Unknown",
    submittedByName: bill.submittedByUserId ? (nameOf.get(bill.submittedByUserId) ?? "Unknown") : null,
    entryNumber: entry[0]?.n ?? null,
    lines: lines.map((l) => ({ ...l, fundName: l.fundName ?? "General Fund" })),
    approvals: approvalRows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      decision: r.decision,
      note: r.note,
      createdAt: r.createdAt,
      current: submittedKey !== undefined && r.submittedAt.getTime() === submittedKey,
    })),
    payments: paymentRows,
    attachments,
  };
}

function computeViewer(ctx: SessionContext, a: FinanceAccess, bill: Omit<BillDetail, "viewer">): BillViewer {
  const isClaimant = bill.kind === "reimbursement" && bill.payeeUserId === ctx.userId;
  const isCreator = bill.createdByUserId === ctx.userId;
  const editable = bill.status === "draft" || bill.status === "rejected";
  const canEdit = editable && canSubmitBillFor(a, bill.programId) && (isCreator || canEditBooks(a)) && bill.kind === "bill";
  const approver = canApproveBills(a);
  const pending = bill.status === "pending_approval";
  const decided = bill.approvals.filter((x) => x.current).map((x) => x.userId);
  const refusal =
    pending && approver
      ? approverRefusal({
          userId: ctx.userId,
          creatorId: bill.createdByUserId,
          submitterId: bill.submittedByUserId,
          payeeUserId: bill.payeeUserId,
          contactUserId: bill.contactUserId,
          decidedUserIds: decided,
        })
      : null;
  const voidable = bill.status !== "void" && bill.status !== "paid" && bill.status !== "partially_paid";
  return {
    isClaimant,
    canEdit,
    canSubmit: canEdit && bill.lines.length > 0 && bill.totalCents > 0,
    canRecategorize: pending && approver,
    canApprove: pending && approver && refusal === null,
    approveBlockedReason: refusal ? APPROVER_REFUSAL_TEXT[refusal] : null,
    canVoid: voidable && (canEditBooks(a) || (canEdit && bill.status !== "approved")),
    canPay: canEditBooks(a) && (bill.status === "approved" || bill.status === "partially_paid"),
    canAttach:
      bill.status !== "void" &&
      ((canEditBooks(a)) ||
        (canSubmitBillFor(a, bill.programId) && isCreator && bill.kind === "bill" && bill.status !== "paid") ||
        (isClaimant && (bill.status === "pending_approval" || bill.status === "rejected"))),
    canWithdraw: isClaimant && bill.status === "pending_approval",
  };
}

/** Full bill for finance readers (org-wide, or program users for their program) and the claimant of a reimbursement. */
export async function getBill(ctx: SessionContext, id: string): Promise<BillDetail> {
  assertUuid(id);
  const a = await getFinanceAccess(ctx);
  const bill = await loadBillDetail(db, id);
  if (!bill) throw new DalError("NOT_FOUND", "Bill not found.");
  const claimant = bill.kind === "reimbursement" && bill.payeeUserId === ctx.userId;
  if (!claimant && !canViewBillsFor(a, bill.programId)) throw new DalError("FORBIDDEN", NO_PERMISSION);
  return { ...bill, viewer: computeViewer(ctx, a, bill) };
}

/** A member's own reimbursement claim (session user only). */
export async function getMyReimbursement(ctx: SessionContext, id: string): Promise<BillDetail> {
  assertUuid(id);
  const a = await getFinanceAccess(ctx);
  const bill = await loadBillDetail(db, id);
  if (!bill || bill.kind !== "reimbursement" || bill.payeeUserId !== ctx.userId) {
    throw new DalError("NOT_FOUND", "Claim not found.");
  }
  return { ...bill, viewer: computeViewer(ctx, a, bill) };
}

export async function listMyReimbursements(ctx: SessionContext): Promise<BillRow[]> {
  return baseRows()
    .where(and(eq(finBills.kind, "reimbursement"), eq(finBills.payeeUserId, ctx.userId)))
    .orderBy(desc(finBills.createdAt))
    .limit(200);
}

// ---------------------------------------------------------------------------
// Approval queue
// ---------------------------------------------------------------------------

export interface QueueRow extends BillRow {
  /** Why I can't decide on it (when in `waiting`). */
  blockedReason: string | null;
  approvalsSoFar: number;
}

export async function listApprovalQueue(ctx: SessionContext): Promise<{ mine: QueueRow[]; waiting: QueueRow[] }> {
  const a = await getFinanceAccess(ctx);
  if (!canApproveBills(a)) throw new DalError("FORBIDDEN", NO_PERMISSION);
  const pending = await baseRows()
    .where(eq(finBills.status, "pending_approval"))
    .orderBy(asc(finBills.submittedAt))
    .limit(500);
  if (pending.length === 0) return { mine: [], waiting: [] };
  const ids = pending.map((p) => p.id);
  const [approvals, meta] = await Promise.all([
    db
      .select({ billId: finBillApprovals.billId, userId: finBillApprovals.userId, submittedAt: finBillApprovals.submittedAt, decision: finBillApprovals.decision })
      .from(finBillApprovals)
      .where(inArray(finBillApprovals.billId, ids)),
    db
      .select({ id: finBills.id, createdBy: finBills.createdByUserId, submittedBy: finBills.submittedByUserId, contactUserId: finContacts.userId })
      .from(finBills)
      .innerJoin(finContacts, eq(finContacts.id, finBills.contactId))
      .where(inArray(finBills.id, ids)),
  ]);
  const metaOf = new Map(meta.map((m) => [m.id, m]));
  const mine: QueueRow[] = [];
  const waiting: QueueRow[] = [];
  for (const p of pending) {
    const m = metaOf.get(p.id)!;
    const round = approvals.filter((x) => x.billId === p.id && x.submittedAt.getTime() === p.submittedAt?.getTime());
    const refusal = approverRefusal({
      userId: ctx.userId,
      creatorId: m.createdBy,
      submitterId: m.submittedBy,
      payeeUserId: p.payeeUserId,
      contactUserId: m.contactUserId,
      decidedUserIds: round.map((r) => r.userId),
    });
    const row: QueueRow = {
      ...p,
      blockedReason: refusal ? APPROVER_REFUSAL_TEXT[refusal] : null,
      approvalsSoFar: round.filter((r) => r.decision === "approve").length,
    };
    (refusal ? waiting : mine).push(row);
  }
  return { mine, waiting };
}

/** Number of bills waiting on this user (0 for non-approvers). Cheap enough for badges. */
export async function countMyApprovals(ctx: SessionContext): Promise<number> {
  const a = await getFinanceAccess(ctx);
  if (!canApproveBills(a)) return 0;
  return (await listApprovalQueue(ctx)).mine.length;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

interface CleanLine {
  accountId: string;
  fundId: string | null;
  programId: string | null;
  amountCents: number;
  description: string | null;
}

async function assertLinesAllowed(
  tx: DbOrTx,
  a: FinanceAccess,
  headerProgramId: string | null,
  lines: CleanLine[]
): Promise<void> {
  const editorPrograms = editorProgramIds(a);
  if (!canSubmitBillFor(a, headerProgramId)) {
    const editsSomeProgram = editorPrograms.length > 0;
    throw new DalError("FORBIDDEN", !headerProgramId && editsSomeProgram ? "Pick one of your programs for this bill." : NO_PERMISSION);
  }
  const orgWide = canEditBooks(a);
  const progIds = [...new Set(lines.map((l) => l.programId).filter((p): p is string => !!p))];
  if (!orgWide) {
    for (const l of lines) {
      if (!l.programId || !editorPrograms.includes(l.programId)) {
        throw new DalError("FORBIDDEN", "Every line must be for one of your programs.");
      }
    }
  }
  if (progIds.length) {
    const found = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(inArray(programs.id, progIds), isNull(programs.deletedAt)));
    if (found.length !== progIds.length) throw new DalError("INVALID", "One of the programs no longer exists.");
  }
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accts = await tx
    .select({ id: finAccounts.id, name: finAccounts.name, type: finAccounts.type, isActive: finAccounts.isActive, isBank: finAccounts.isBank, systemKey: finAccounts.systemKey })
    .from(finAccounts)
    .where(inArray(finAccounts.id, accountIds));
  if (accts.length !== accountIds.length) throw new DalError("INVALID", "Unknown category.");
  for (const ac of accts) {
    if (!ac.isActive) throw new DalError("INVALID", `The category "${ac.name}" is inactive. Pick another.`);
    if (ac.isBank || ac.systemKey || (ac.type !== "expense" && ac.type !== "asset")) {
      throw new DalError("INVALID", `"${ac.name}" can't be used on a bill. Pick an expense category.`);
    }
  }
  const fundIds = [...new Set(lines.map((l) => l.fundId).filter((f): f is string => !!f))];
  if (fundIds.length) {
    const funds = await tx.select({ id: finFunds.id, isActive: finFunds.isActive, name: finFunds.name }).from(finFunds).where(inArray(finFunds.id, fundIds));
    if (funds.length !== fundIds.length) throw new DalError("INVALID", "Unknown fund.");
    const dead = funds.find((f) => !f.isActive);
    if (dead) throw new DalError("INVALID", `The fund "${dead.name}" is inactive.`);
  }
}

async function resolveVendor(
  ctx: SessionContext,
  tx: DbTx,
  data: { contactId: string | null; newVendor?: { displayName: string; email: string | null; phone: string | null; kind: "individual" | "organization" } | null }
): Promise<string> {
  if (data.contactId) {
    const [c] = await tx
      .select({ id: finContacts.id, isVendor: finContacts.isVendor, isActive: finContacts.isActive })
      .from(finContacts)
      .where(eq(finContacts.id, data.contactId))
      .limit(1);
    if (!c || !c.isVendor || !c.isActive) throw new DalError("INVALID", "Choose an active vendor.");
    return c.id;
  }
  const nv = data.newVendor!;
  const { id } = await createContact(
    ctx,
    { displayName: nv.displayName, email: nv.email ?? undefined, phone: nv.phone ?? undefined, kind: nv.kind, isVendor: true },
    tx
  );
  return id;
}

async function lockBill(tx: DbTx, id: string) {
  assertUuid(id);
  const [b] = await tx.select().from(finBills).where(eq(finBills.id, id)).for("update").limit(1);
  if (!b) throw new DalError("NOT_FOUND", "Bill not found.");
  return b;
}

function sumLines(lines: { amountCents: number }[]): number {
  return lines.reduce((s, l) => s + l.amountCents, 0);
}

async function saveFiles(tx: DbTx, ctx: SessionContext, billId: string, files: File[]): Promise<number> {
  let n = 0;
  for (const file of files) {
    const { id } = await storeAttachment(tx, { ownerType: "bill", ownerId: billId, file, userId: ctx.userId });
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.attachment_added", targetType: "fin_attachment", targetId: id, metadata: { billId } },
      tx
    );
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Draft create / edit
// ---------------------------------------------------------------------------

/** Create a draft bill (org-wide bookkeepers, or a program editor for their own program). */
export async function createBill(ctx: SessionContext, input: BillInput, files: File[] = []): Promise<{ id: string }> {
  const a = await getFinanceAccess(ctx);
  const data = billInputSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertLinesAllowed(tx, a, data.programId, data.lines);
    const contactId = await resolveVendor(ctx, tx, data);
    const [row] = await tx
      .insert(finBills)
      .values({
        kind: "bill",
        contactId,
        vendorInvoiceNumber: data.vendorInvoiceNumber,
        programId: data.programId,
        billDate: data.billDate,
        dueDate: data.dueDate,
        memo: data.memo,
        totalCents: sumLines(data.lines),
        status: "draft",
        createdByUserId: ctx.userId,
      })
      .returning({ id: finBills.id });
    await tx.insert(finBillLines).values(data.lines.map((l, i) => ({ billId: row.id, lineNo: i + 1, ...l })));
    await saveFiles(tx, ctx, row.id, files);
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.bill_created", targetType: "fin_bill", targetId: row.id, metadata: { totalCents: sumLines(data.lines), contactId } },
      tx
    );
    return row;
  });
}

/** Edit a draft or rejected bill (creator, or an org-wide bookkeeper). */
export async function updateBill(ctx: SessionContext, id: string, input: BillInput, files: File[] = []): Promise<void> {
  const a = await getFinanceAccess(ctx);
  const data = billInputSchema.parse(input);
  await db.transaction(async (tx) => {
    const bill = await lockBill(tx, id);
    if (bill.kind !== "bill") throw new DalError("INVALID", "Reimbursements are reviewed from the claim page.");
    if (bill.status !== "draft" && bill.status !== "rejected") throw new DalError("INVALID", "Only drafts and returned bills can be edited.");
    if (!canSubmitBillFor(a, bill.programId) || (bill.createdByUserId !== ctx.userId && !canEditBooks(a))) {
      throw new DalError("FORBIDDEN", NO_PERMISSION);
    }
    await assertLinesAllowed(tx, a, data.programId, data.lines);
    const contactId = await resolveVendor(ctx, tx, data);
    await tx
      .update(finBills)
      .set({
        contactId,
        vendorInvoiceNumber: data.vendorInvoiceNumber,
        programId: data.programId,
        billDate: data.billDate,
        dueDate: data.dueDate,
        memo: data.memo,
        totalCents: sumLines(data.lines),
      })
      .where(eq(finBills.id, id));
    await tx.delete(finBillLines).where(eq(finBillLines.billId, id));
    await tx.insert(finBillLines).values(data.lines.map((l, i) => ({ billId: id, lineNo: i + 1, ...l })));
    await saveFiles(tx, ctx, id, files);
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.bill_updated", targetType: "fin_bill", targetId: id, metadata: { totalCents: sumLines(data.lines) } },
      tx
    );
  });
}

/**
 * Re-categorize a pending bill or reimbursement (account / fund / program / note per line).
 * Amounts and line count must not change, so this is NOT a resubmit and existing approvals stand.
 */
export async function recategorizeBill(ctx: SessionContext, id: string, input: { lines: BillInput["lines"] }): Promise<void> {
  const a = await getFinanceAccess(ctx);
  if (!canApproveBills(a)) throw new DalError("FORBIDDEN", NO_PERMISSION);
  const data = recategorizeSchema.parse(input);
  await db.transaction(async (tx) => {
    const bill = await lockBill(tx, id);
    if (bill.status !== "pending_approval") throw new DalError("INVALID", "Only bills waiting for approval can be re-categorized.");
    const existing = await tx.select().from(finBillLines).where(eq(finBillLines.billId, id)).orderBy(asc(finBillLines.lineNo));
    if (existing.length !== data.lines.length || existing.some((e, i) => e.amountCents !== data.lines[i].amountCents)) {
      throw new DalError("INVALID", "Amounts can't change while a bill is waiting for approval. Send it back instead.");
    }
    const lines = data.lines.map((l) => ({ ...l, description: l.description ?? null, fundId: l.fundId ?? null, programId: l.programId ?? null }));
    await assertLinesAllowed(tx, a, bill.programId, lines);
    await tx.delete(finBillLines).where(eq(finBillLines.billId, id));
    await tx.insert(finBillLines).values(lines.map((l, i) => ({ billId: id, lineNo: i + 1, ...l })));
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.bill_updated", targetType: "fin_bill", targetId: id, metadata: { recategorized: true } },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Submit / decide
// ---------------------------------------------------------------------------

async function getThreshold(tx: DbOrTx): Promise<number | null> {
  const [s] = await tx.select({ t: finSettings.dualApprovalThresholdCents }).from(finSettings).where(eq(finSettings.id, 1)).limit(1);
  return s?.t ?? null;
}

type EmailJob = () => Promise<void>;

async function runEmailJobs(jobs: EmailJob[]): Promise<void> {
  // Best effort, after the transaction committed: an email problem never fails the action.
  await Promise.allSettled(jobs.map((j) => j().catch((e) => console.error("[finance-bills] email failed", e))));
}

async function sendTo(email: string | null | undefined, bounced: boolean | null | undefined, built: BuiltEmail): Promise<void> {
  if (!email || bounced) return;
  await sendHtmlEmail({ to: email, subject: built.subject, html: built.html });
}

/** Org-wide finance admins/editors (and super admins) who may approve this bill. */
async function approverRecipients(billId: string): Promise<{ id: string; email: string; name: string; bounced: boolean }[]> {
  const [bill] = await db
    .select({
      createdBy: finBills.createdByUserId,
      submittedBy: finBills.submittedByUserId,
      payee: finBills.payeeUserId,
      contactUserId: finContacts.userId,
    })
    .from(finBills)
    .innerJoin(finContacts, eq(finContacts.id, finBills.contactId))
    .where(eq(finBills.id, billId))
    .limit(1);
  if (!bill) return [];
  const excluded = new Set([bill.createdBy, bill.submittedBy, bill.payee, bill.contactUserId].filter((x): x is string => !!x));
  const granted = await db
    .select({ userId: finRoles.userId })
    .from(finRoles)
    .where(and(isNull(finRoles.revokedAt), isNull(finRoles.programId), inArray(finRoles.role, ["admin", "editor"])));
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, bounced: users.emailBounced })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(eq(users.orgRole, "super_admin"), granted.length ? inArray(users.id, granted.map((g) => g.userId)) : sql`false`)
      )
    );
  return rows.filter((r) => !excluded.has(r.id));
}

async function notifyApprovers(billId: string): Promise<void> {
  const [b] = await db
    .select({
      kind: finBills.kind,
      total: finBills.totalCents,
      memo: finBills.memo,
      required: finBills.approvalsRequired,
      contactName: finContacts.displayName,
      submittedBy: users.name,
    })
    .from(finBills)
    .innerJoin(finContacts, eq(finContacts.id, finBills.contactId))
    .leftJoin(users, eq(users.id, finBills.submittedByUserId))
    .where(eq(finBills.id, billId))
    .limit(1);
  if (!b) return;
  const built = approvalNeededEmail({
    kind: b.kind,
    payeeName: b.contactName,
    totalCents: b.total,
    memo: b.memo,
    submittedBy: b.submittedBy ?? "Someone",
    approvalsRequired: b.required,
    url: appUrl(`/finance/payables/${billId}`),
  });
  const recipients = await approverRecipients(billId);
  await Promise.allSettled(recipients.map((r) => sendTo(r.email, r.bounced, built)));
}

/** Submit a draft (or returned) bill for approval. */
export async function submitBill(ctx: SessionContext, id: string): Promise<{ approvalsRequired: number }> {
  const a = await getFinanceAccess(ctx);
  const res = await db.transaction(async (tx) => {
    const bill = await lockBill(tx, id);
    if (bill.kind !== "bill") throw new DalError("INVALID", "That can't be submitted.");
    if (bill.status !== "draft" && bill.status !== "rejected") throw new DalError("INVALID", "This bill was already submitted.");
    if (!canSubmitBillFor(a, bill.programId) || (bill.createdByUserId !== ctx.userId && !canEditBooks(a))) {
      throw new DalError("FORBIDDEN", NO_PERMISSION);
    }
    const lines = await tx.select().from(finBillLines).where(eq(finBillLines.billId, id));
    if (lines.length === 0 || bill.totalCents <= 0) throw new DalError("INVALID", "Add at least one line before submitting.");
    await assertLinesAllowed(tx, a, bill.programId, lines);
    const required = approvalsRequiredFor(bill.totalCents, await getThreshold(tx));
    await tx
      .update(finBills)
      .set({
        status: "pending_approval",
        submittedAt: new Date(),
        submittedByUserId: ctx.userId,
        approvalsRequired: required,
        rejectedReason: null,
      })
      .where(eq(finBills.id, id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.bill_submitted", targetType: "fin_bill", targetId: id, metadata: { totalCents: bill.totalCents, approvalsRequired: required } },
      tx
    );
    return { approvalsRequired: required };
  });
  await runEmailJobs([() => notifyApprovers(id)]);
  return res;
}

export interface DecideResult {
  status: BillStatus;
  /** True when this decision posted the bill to the books. */
  posted: boolean;
  entryNumber: number | null;
  approvals: number;
  required: number;
}

/**
 * Approve or reject a pending bill. The approver can't be the creator, submitter or payee,
 * and decides once per round. The final approval posts Dr line accounts / Cr A/P (2000) or
 * Reimbursements payable (2010). A bill dated in a closed period posts on the first open day.
 */
export async function decideBill(ctx: SessionContext, id: string, input: DecisionInput): Promise<DecideResult> {
  const a = await getFinanceAccess(ctx);
  if (!canApproveBills(a)) throw new DalError("FORBIDDEN", NO_PERMISSION);
  const data = decisionSchema.parse(input);
  const jobs: EmailJob[] = [];

  const result = await db.transaction(async (tx): Promise<DecideResult> => {
    const bill = await lockBill(tx, id);
    if (bill.status !== "pending_approval" || !bill.submittedAt) {
      throw new DalError("INVALID", bill.status === "approved" ? "This was already approved." : "This isn't waiting for approval.");
    }
    const [contact] = await tx
      .select({ name: finContacts.displayName, userId: finContacts.userId })
      .from(finContacts)
      .where(eq(finContacts.id, bill.contactId))
      .limit(1);
    const roundKey = bill.submittedAt.getTime();
    const round = (
      await tx.select().from(finBillApprovals).where(eq(finBillApprovals.billId, id))
    ).filter((r) => r.submittedAt.getTime() === roundKey);
    const refusal = approverRefusal({
      userId: ctx.userId,
      creatorId: bill.createdByUserId,
      submitterId: bill.submittedByUserId,
      payeeUserId: bill.payeeUserId,
      contactUserId: contact?.userId ?? null,
      decidedUserIds: round.map((r) => r.userId),
    });
    if (refusal) throw new DalError("FORBIDDEN", APPROVER_REFUSAL_TEXT[refusal]);

    await tx.insert(finBillApprovals).values({
      billId: id,
      submittedAt: bill.submittedAt,
      userId: ctx.userId,
      decision: data.decision,
      note: data.note,
    });

    if (data.decision === "reject") {
      await tx.update(finBills).set({ status: "rejected", rejectedReason: data.note }).where(eq(finBills.id, id));
      await writeAudit(
        { actorUserId: ctx.userId, action: "finance.bill_rejected", targetType: "fin_bill", targetId: id, metadata: { reason: data.note } },
        tx
      );
      jobs.push(() => notifyRejected(id, data.note ?? ""));
      return { status: "rejected", posted: false, entryNumber: null, approvals: 0, required: bill.approvalsRequired };
    }

    const tally = tallyApprovals(bill.approvalsRequired, [
      ...round.map((r) => ({ userId: r.userId, decision: r.decision })),
      { userId: ctx.userId, decision: "approve" as const },
    ]);
    if (tally.state !== "approved") {
      await writeAudit(
        { actorUserId: ctx.userId, action: "finance.bill_approved", targetType: "fin_bill", targetId: id, metadata: { final: false, approvals: tally.approvals, required: tally.required, note: data.note } },
        tx
      );
      return { status: "pending_approval", posted: false, entryNumber: null, approvals: tally.approvals, required: tally.required };
    }

    // Final approval: post to the ledger.
    const lines = await tx.select().from(finBillLines).where(eq(finBillLines.billId, id)).orderBy(asc(finBillLines.lineNo));
    const total = sumLines(lines);
    if (lines.length === 0 || total !== bill.totalCents) throw new DalError("INVALID", "The lines don't add up to the bill total.");
    const payableId = await systemAccountId(tx, bill.kind === "reimbursement" ? "reimbursements_payable" : "accounts_payable");
    const lock = await getLockDate(tx);
    let entryDate: IsoDate = bill.billDate;
    let memo = `${bill.kind === "reimbursement" ? "Reimbursement to" : "Bill from"} ${contact?.name ?? "vendor"}${bill.vendorInvoiceNumber ? ` #${bill.vendorInvoiceNumber}` : ""}: ${bill.memo}`;
    if (lock && entryDate <= lock) {
      memo = `${memo} (dated ${fmtDay(bill.billDate)})`;
      entryDate = addDays(lock, 1);
    }
    const posted = await postEntry(tx, {
      entryDate,
      memo,
      source: bill.kind === "reimbursement" ? "reimbursement" : "bill",
      sourceRef: bill.id,
      createdByUserId: ctx.userId,
      lines: [
        ...lines.map((l) => ({
          accountId: l.accountId,
          fundId: l.fundId,
          programId: l.programId,
          debitCents: l.amountCents,
          description: l.description,
        })),
        { accountId: payableId, creditCents: total, description: contact?.name ?? null },
      ],
    });
    await tx.update(finBills).set({ status: "approved", journalEntryId: posted.entryId }).where(eq(finBills.id, id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.bill_approved", targetType: "fin_bill", targetId: id, metadata: { final: true, entryNumber: posted.entryNumber, entryDate, note: data.note } },
      tx
    );
    if (bill.kind === "reimbursement") jobs.push(() => notifyReimbursementApproved(id));
    return { status: "approved", posted: true, entryNumber: posted.entryNumber, approvals: tally.approvals, required: tally.required };
  });

  await runEmailJobs(jobs);
  return result;
}

async function notifyRejected(billId: string, reason: string): Promise<void> {
  const [b] = await db
    .select({
      kind: finBills.kind,
      total: finBills.totalCents,
      memo: finBills.memo,
      payee: finBills.payeeUserId,
      creator: finBills.createdByUserId,
      contactName: finContacts.displayName,
    })
    .from(finBills)
    .innerJoin(finContacts, eq(finContacts.id, finBills.contactId))
    .where(eq(finBills.id, billId))
    .limit(1);
  if (!b) return;
  const [u] = await db
    .select({ email: users.email, name: users.name, bounced: users.emailBounced })
    .from(users)
    .where(eq(users.id, b.kind === "reimbursement" && b.payee ? b.payee : b.creator))
    .limit(1);
  if (!u) return;
  const built =
    b.kind === "reimbursement"
      ? reimbursementDecisionEmail({ name: u.name, approved: false, totalCents: b.total, memo: b.memo, reason, url: appUrl(`/reimbursements/${billId}`) })
      : billRejectedEmail({ name: u.name, payeeName: b.contactName, totalCents: b.total, reason, url: appUrl(`/finance/payables/${billId}`) });
  await sendTo(u.email, u.bounced, built);
}

async function notifyReimbursementApproved(billId: string): Promise<void> {
  const [b] = await db
    .select({ total: finBills.totalCents, memo: finBills.memo, payee: finBills.payeeUserId })
    .from(finBills)
    .where(eq(finBills.id, billId))
    .limit(1);
  if (!b?.payee) return;
  const [u] = await db.select({ email: users.email, name: users.name, bounced: users.emailBounced }).from(users).where(eq(users.id, b.payee)).limit(1);
  if (!u) return;
  await sendTo(
    u.email,
    u.bounced,
    reimbursementDecisionEmail({ name: u.name, approved: true, totalCents: b.total, memo: b.memo, url: appUrl(`/reimbursements/${billId}`) })
  );
}

// ---------------------------------------------------------------------------
// Void / withdraw
// ---------------------------------------------------------------------------

async function liveApplicationCount(tx: DbOrTx, billId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(finPaymentApplications)
    .innerJoin(finPayments, eq(finPayments.id, finPaymentApplications.paymentId))
    .where(and(eq(finPaymentApplications.billId, billId), isNull(finPayments.voidedAt)));
  return r?.n ?? 0;
}

async function voidBillTx(tx: DbTx, ctx: SessionContext, bill: typeof finBills.$inferSelect, reason: string): Promise<void> {
  if (bill.status === "void") throw new DalError("INVALID", "This is already void.");
  if ((await liveApplicationCount(tx, bill.id)) > 0) {
    throw new DalError("INVALID", "This bill has payments. Void the payments first, then void the bill.");
  }
  if (bill.journalEntryId) {
    await voidEntry(tx, { entryId: bill.journalEntryId, userId: ctx.userId, reason });
  }
  await tx
    .update(finBills)
    .set({ status: "void", voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: reason, paidCents: 0 })
    .where(eq(finBills.id, bill.id));
  await writeAudit(
    { actorUserId: ctx.userId, action: "finance.bill_voided", targetType: "fin_bill", targetId: bill.id, metadata: { reason, wasPosted: !!bill.journalEntryId } },
    tx
  );
}

/** Void a bill (reason required). Posted bills with live payments are refused; void the payments first. */
export async function voidBill(ctx: SessionContext, id: string, reason: string): Promise<void> {
  const a = await getFinanceAccess(ctx);
  const why = voidReasonSchema.parse(reason);
  await db.transaction(async (tx) => {
    const bill = await lockBill(tx, id);
    const own = bill.createdByUserId === ctx.userId && canSubmitBillFor(a, bill.programId) && (bill.status === "draft" || bill.status === "rejected") && bill.kind === "bill";
    if (!canEditBooks(a) && !own) throw new DalError("FORBIDDEN", NO_PERMISSION);
    await voidBillTx(tx, ctx, bill, why);
  });
}

/** A claimant withdraws their own pending reimbursement claim. */
export async function withdrawReimbursement(ctx: SessionContext, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const bill = await lockBill(tx, id);
    if (bill.kind !== "reimbursement" || bill.payeeUserId !== ctx.userId) throw new DalError("NOT_FOUND", "Claim not found.");
    if (bill.status !== "pending_approval") throw new DalError("INVALID", "Only claims that are still waiting for review can be withdrawn.");
    await voidBillTx(tx, ctx, bill, "Withdrawn by the claimant");
  });
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

async function assertCanAttach(ctx: SessionContext, a: FinanceAccess, bill: typeof finBills.$inferSelect): Promise<void> {
  if (bill.status === "void") throw new DalError("INVALID", "This is void.");
  const isClaimant = bill.kind === "reimbursement" && bill.payeeUserId === ctx.userId;
  const ok =
    canEditBooks(a) ||
    (bill.kind === "bill" && canSubmitBillFor(a, bill.programId) && bill.createdByUserId === ctx.userId && bill.status !== "paid") ||
    (isClaimant && (bill.status === "pending_approval" || bill.status === "rejected"));
  if (!ok) throw new DalError("FORBIDDEN", NO_PERMISSION);
}

export async function addBillAttachments(ctx: SessionContext, billId: string, files: File[]): Promise<number> {
  const a = await getFinanceAccess(ctx);
  if (files.length === 0) throw new DalError("INVALID", "Choose a file to upload.");
  return db.transaction(async (tx) => {
    const bill = await lockBill(tx, billId);
    await assertCanAttach(ctx, a, bill);
    return saveFiles(tx, ctx, billId, files);
  });
}

export async function removeBillAttachment(ctx: SessionContext, billId: string, attachmentId: string): Promise<void> {
  const a = await getFinanceAccess(ctx);
  await db.transaction(async (tx) => {
    const bill = await lockBill(tx, billId);
    await assertCanAttach(ctx, a, bill);
    const existing = await listAttachments(tx, "bill", billId);
    const target = existing.find((x) => x.id === attachmentId);
    if (!target) throw new DalError("NOT_FOUND", "File not found.");
    if (bill.kind === "reimbursement" && existing.length <= 1) {
      throw new DalError("INVALID", "A reimbursement needs at least one receipt. Add another before removing this one.");
    }
    if (bill.kind === "reimbursement" && bill.payeeUserId === ctx.userId && !canEditBooks(a) && target.uploadedByUserId !== ctx.userId) {
      throw new DalError("FORBIDDEN", NO_PERMISSION);
    }
    await softDeleteAttachment(tx, attachmentId, ctx.userId);
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.attachment_removed", targetType: "fin_attachment", targetId: attachmentId, metadata: { billId } },
      tx
    );
  });
}

/** Bytes of a bill attachment for the download route. Reads follow the bill's read access. */
export async function readBillAttachment(
  ctx: SessionContext,
  attachmentId: string
): Promise<{ fileName: string; contentType: string; body: Buffer }> {
  const att = await getAttachment(attachmentId);
  if (!att || att.ownerType !== "bill") throw new DalError("NOT_FOUND", "File not found.");
  await getBill(ctx, att.ownerId); // authorizes (finance reader of that program, or the claimant)
  const obj = await readAttachmentBytes(att.objectKey);
  if (!obj) throw new DalError("NOT_FOUND", "File not found.");
  return { fileName: att.fileName, contentType: att.contentType, body: obj.body };
}

// ---------------------------------------------------------------------------
// Reimbursements (any signed-in member)
// ---------------------------------------------------------------------------

export interface ReimbursementOptions {
  programs: { id: string; name: string }[];
  /** Programs the member is involved in (for sorting / defaulting). */
  myProgramIds: string[];
}

export async function getReimbursementOptions(ctx: SessionContext): Promise<ReimbursementOptions> {
  const progs = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(and(isNull(programs.deletedAt), eq(programs.isActive, true)))
    .orderBy(asc(programs.name));
  const mine = new Set([...ctx.programRoles.map((g) => g.programId), ...ctx.teamStaff.map((t) => t.programId)]);
  return { programs: progs, myProgramIds: [...mine] };
}

/** Member submits a reimbursement claim: pending approval straight away, at least one receipt. */
export async function submitReimbursement(
  ctx: SessionContext,
  input: ReimbursementInput,
  receipts: File[]
): Promise<{ id: string }> {
  const data = reimbursementInputSchema.parse(input);
  if (receipts.length === 0) throw new DalError("INVALID", "Add at least one photo or PDF of your receipt.");
  if (receipts.length > 10) throw new DalError("INVALID", "You can attach up to 10 receipts.");
  const today = laToday();
  if (data.claimDate > today) throw new DalError("INVALID", "The date can't be in the future.");
  const res = await db.transaction(async (tx) => {
    if (data.programId) {
      const [p] = await tx
        .select({ id: programs.id })
        .from(programs)
        .where(and(eq(programs.id, data.programId), isNull(programs.deletedAt), eq(programs.isActive, true)))
        .limit(1);
      if (!p) throw new DalError("INVALID", "Pick a program from the list.");
    }
    const [misc] = await tx.select({ id: finAccounts.id, isActive: finAccounts.isActive }).from(finAccounts).where(eq(finAccounts.code, "6900")).limit(1);
    if (!misc?.isActive) throw new DalError("INVALID", "Reimbursements aren't set up yet. Please contact the treasurer.");
    const contactId = await ensureContactForUser(tx, ctx.userId, "vendor");
    const total = sumLines(data.lines);
    const required = approvalsRequiredFor(total, await getThreshold(tx));
    const [bill] = await tx
      .insert(finBills)
      .values({
        kind: "reimbursement",
        contactId,
        payeeUserId: ctx.userId,
        programId: data.programId,
        billDate: data.claimDate,
        dueDate: addDays(today, 14),
        memo: data.memo,
        totalCents: total,
        status: "pending_approval",
        approvalsRequired: required,
        createdByUserId: ctx.userId,
        submittedByUserId: ctx.userId,
        submittedAt: new Date(),
      })
      .returning({ id: finBills.id });
    await tx.insert(finBillLines).values(
      data.lines.map((l, i) => ({
        billId: bill.id,
        lineNo: i + 1,
        accountId: misc.id,
        fundId: null,
        programId: data.programId,
        amountCents: l.amountCents,
        description: l.description,
      }))
    );
    await saveFiles(tx, ctx, bill.id, receipts);
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.reimbursement_submitted", targetType: "fin_bill", targetId: bill.id, metadata: { totalCents: total, approvalsRequired: required } },
      tx
    );
    return bill;
  });
  await runEmailJobs([() => notifyApprovers(res.id)]);
  return res;
}
