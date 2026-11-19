import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx, type DbTx } from "@/db";
import { finAccounts, finClearedLines, finJournalEntries, finJournalLines, finReconciliations, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import { isDebitNormal, naturalBalance, sumLines, type FinAccountType } from "./finance-ledger";
import { clearLinesSchema, reconciliationIdSchema, startReconciliationSchema } from "@/lib/validation/finance-banking";

/**
 * Bank reconciliation (workstream FB). A reconciliation belongs to one bank-type GL
 * account. Lines are "cleared" into it; it can be completed only when
 *   statement ending balance = beginning balance + cleared lines
 * where the beginning balance is the sum of lines cleared in earlier completed
 * reconciliations (so the opening-balance entry is itself a line to clear the first time).
 * Amounts are the account's natural balance (asset: debit - credit; liability: credit - debit).
 */

export interface ReconcileAccountSummary {
  id: string;
  label: string;
  type: string;
  glBalanceCents: number;
  open: { id: string; statementEndDate: string } | null;
  lastCompleted: { id: string; statementEndDate: string; endingBalanceCents: number; completedAt: Date | null } | null;
}

export interface ReconciliationHistoryRow {
  id: string;
  glAccountId: string;
  accountLabel: string;
  statementEndDate: string;
  endingBalanceCents: number;
  completedAt: Date | null;
  completedByName: string | null;
}

export async function getReconcileOverview(ctx: SessionContext): Promise<{
  accounts: ReconcileAccountSummary[];
  history: ReconciliationHistoryRow[];
}> {
  await requireFinance(ctx, "view_all");
  const accts = await db
    .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, type: finAccounts.type })
    .from(finAccounts)
    .where(and(eq(finAccounts.isBank, true), eq(finAccounts.isActive, true)))
    .orderBy(asc(finAccounts.code));
  if (accts.length === 0) return { accounts: [], history: [] };
  const totals = await sumLines(db, { accountIds: accts.map((a) => a.id) });
  const recs = await db
    .select()
    .from(finReconciliations)
    .where(inArray(finReconciliations.glAccountId, accts.map((a) => a.id)))
    .orderBy(desc(finReconciliations.statementEndDate), desc(finReconciliations.createdAt));
  const label = new Map(accts.map((a) => [a.id, `${a.code} ${a.name}`]));

  const accounts = accts.map<ReconcileAccountSummary>((a) => {
    const t = totals.filter((x) => x.accountId === a.id);
    const d = t.reduce((s, x) => s + x.debitCents, 0);
    const c = t.reduce((s, x) => s + x.creditCents, 0);
    const open = recs.find((r) => r.glAccountId === a.id && r.status === "in_progress");
    const last = recs.find((r) => r.glAccountId === a.id && r.status === "completed");
    return {
      id: a.id,
      label: `${a.code} ${a.name}`,
      type: a.type,
      glBalanceCents: naturalBalance(a.type as FinAccountType, d, c),
      open: open ? { id: open.id, statementEndDate: open.statementEndDate } : null,
      lastCompleted: last
        ? { id: last.id, statementEndDate: last.statementEndDate, endingBalanceCents: last.statementEndingBalanceCents, completedAt: last.completedAt }
        : null,
    };
  });

  const completed = recs.filter((r) => r.status === "completed").slice(0, 100);
  const userIds = [...new Set(completed.flatMap((r) => (r.completedByUserId ? [r.completedByUserId] : [])))];
  const names = userIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return {
    accounts,
    history: completed.map((r) => ({
      id: r.id,
      glAccountId: r.glAccountId,
      accountLabel: label.get(r.glAccountId) ?? "",
      statementEndDate: r.statementEndDate,
      endingBalanceCents: r.statementEndingBalanceCents,
      completedAt: r.completedAt,
      completedByName: r.completedByUserId ? (nameOf.get(r.completedByUserId) ?? null) : null,
    })),
  };
}

async function accountType(tx: DbOrTx, glAccountId: string) {
  const [a] = await tx
    .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, type: finAccounts.type, isBank: finAccounts.isBank })
    .from(finAccounts)
    .where(eq(finAccounts.id, glAccountId))
    .limit(1);
  if (!a) throw new DalError("NOT_FOUND", "Account not found.");
  return a;
}

function signed(type: FinAccountType, debit: number, credit: number): number {
  return isDebitNormal(type) ? debit - credit : credit - debit;
}

/** Sum (natural sign) of lines on the account cleared in COMPLETED reconciliations. */
async function beginningBalance(tx: DbOrTx, glAccountId: string, type: FinAccountType): Promise<number> {
  const r = await tx.execute<{ d: string; c: string }>(sql`
    select coalesce(sum(l.debit_cents), 0)::text as d, coalesce(sum(l.credit_cents), 0)::text as c
    from fin_cleared_lines cl
    join fin_reconciliations r on r.id = cl.reconciliation_id and r.status = 'completed'
    join fin_journal_lines l on l.id = cl.line_id
    where l.account_id = ${glAccountId}::uuid
  `);
  return signed(type, Number(r.rows[0]?.d ?? 0), Number(r.rows[0]?.c ?? 0));
}

export async function startReconciliation(ctx: SessionContext, input: unknown): Promise<{ id: string; beginningBalanceCents: number }> {
  await requireFinance(ctx, "edit");
  const v = startReconciliationSchema.parse(input);
  return db.transaction(async (tx) => {
    const acct = await accountType(tx, v.glAccountId);
    if (!acct.isBank) throw new DalError("INVALID", "Choose a bank or cash account.");
    const begin = await beginningBalance(tx, acct.id, acct.type);
    try {
      const [row] = await tx
        .insert(finReconciliations)
        .values({
          glAccountId: acct.id,
          statementEndDate: v.statementEndDate,
          statementEndingBalanceCents: v.endingBalanceCents,
          beginningBalanceCents: begin,
          createdByUserId: ctx.userId,
        })
        .returning({ id: finReconciliations.id });
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "finance.reconciliation_started",
          targetType: "fin_reconciliation",
          targetId: row.id,
          metadata: { account: `${acct.code} ${acct.name}`, statementEndDate: v.statementEndDate, endingBalanceCents: v.endingBalanceCents, beginningBalanceCents: begin },
        },
        tx
      );
      return { id: row.id, beginningBalanceCents: begin };
    } catch (err) {
      if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
        throw new DalError("INVALID", "This account already has a reconciliation in progress. Finish or discard it first.");
      }
      throw err;
    }
  });
}

export interface ReconcileLine {
  lineId: string;
  entryId: string;
  entryNumber: number;
  entryDate: string;
  memo: string;
  source: string;
  description: string | null;
  /** Natural-sign amount: positive increases the account balance. */
  amountCents: number;
  cleared: boolean;
}

export interface ReconciliationDetail {
  id: string;
  glAccountId: string;
  accountLabel: string;
  accountType: string;
  status: "in_progress" | "completed";
  statementEndDate: string;
  statementEndingBalanceCents: number;
  beginningBalanceCents: number;
  clearedTotalCents: number;
  clearedBalanceCents: number;
  differenceCents: number;
  clearedCount: number;
  createdAt: Date;
  completedAt: Date | null;
  completedByName: string | null;
  createdByName: string | null;
  lines: ReconcileLine[];
}

export async function getReconciliation(ctx: SessionContext, id: string): Promise<ReconciliationDetail> {
  await requireFinance(ctx, "view_all");
  const [rec] = await db.select().from(finReconciliations).where(eq(finReconciliations.id, id)).limit(1);
  if (!rec) throw new DalError("NOT_FOUND", "Reconciliation not found.");
  const acct = await accountType(db, rec.glAccountId);
  const type = acct.type as FinAccountType;

  // Lines already cleared into this reconciliation, plus (while in progress) uncleared candidates.
  const inProgress = rec.status === "in_progress";
  const rows = await db.execute<{
    line_id: string;
    entry_id: string;
    entry_number: string;
    entry_date: string;
    memo: string;
    source: string;
    description: string | null;
    debit: number;
    credit: number;
    cleared: boolean;
  }>(sql`
    select l.id as line_id, e.id as entry_id, e.entry_number::text as entry_number, e.entry_date::text as entry_date,
           e.memo, e.source::text as source, l.description, l.debit_cents as debit, l.credit_cents as credit,
           (cl.reconciliation_id is not null) as cleared
    from fin_journal_lines l
    join fin_journal_entries e on e.id = l.entry_id
    left join fin_cleared_lines cl on cl.line_id = l.id
    where l.account_id = ${rec.glAccountId}::uuid
      and e.voided_at is null
      and (
        cl.reconciliation_id = ${rec.id}::uuid
        ${inProgress ? sql`or (cl.line_id is null and e.entry_date <= ${rec.statementEndDate}::date)` : sql``}
      )
    order by e.entry_date, e.entry_number, l.line_no
  `);
  const lines: ReconcileLine[] = rows.rows.map((r) => ({
    lineId: r.line_id,
    entryId: r.entry_id,
    entryNumber: Number(r.entry_number),
    entryDate: r.entry_date,
    memo: r.memo,
    source: r.source,
    description: r.description,
    amountCents: signed(type, r.debit, r.credit),
    cleared: r.cleared,
  }));
  const clearedLines = lines.filter((l) => l.cleared);
  const clearedTotal = clearedLines.reduce((s, l) => s + l.amountCents, 0);
  const clearedBalance = rec.beginningBalanceCents + clearedTotal;

  const names = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [rec.createdByUserId, ...(rec.completedByUserId ? [rec.completedByUserId] : [])]));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return {
    id: rec.id,
    glAccountId: rec.glAccountId,
    accountLabel: `${acct.code} ${acct.name}`,
    accountType: acct.type,
    status: rec.status as "in_progress" | "completed",
    statementEndDate: rec.statementEndDate,
    statementEndingBalanceCents: rec.statementEndingBalanceCents,
    beginningBalanceCents: rec.beginningBalanceCents,
    clearedTotalCents: clearedTotal,
    clearedBalanceCents: clearedBalance,
    differenceCents: rec.statementEndingBalanceCents - clearedBalance,
    clearedCount: clearedLines.length,
    createdAt: rec.createdAt,
    completedAt: rec.completedAt,
    completedByName: rec.completedByUserId ? (nameOf.get(rec.completedByUserId) ?? null) : null,
    createdByName: nameOf.get(rec.createdByUserId) ?? null,
    lines,
  };
}

async function lockInProgress(tx: DbTx, id: string) {
  const [rec] = await tx.select().from(finReconciliations).where(eq(finReconciliations.id, id)).for("update").limit(1);
  if (!rec) throw new DalError("NOT_FOUND", "Reconciliation not found.");
  if (rec.status !== "in_progress") throw new DalError("INVALID", "This reconciliation is already completed.");
  return rec;
}

/** Mark lines cleared / not cleared in an in-progress reconciliation. */
export async function setLinesCleared(ctx: SessionContext, input: unknown): Promise<void> {
  await requireFinance(ctx, "edit");
  const v = clearLinesSchema.parse(input);
  const ids = [...new Set(v.lineIds)];
  await db.transaction(async (tx) => {
    const rec = await lockInProgress(tx, v.reconciliationId);
    if (!v.cleared) {
      await tx
        .delete(finClearedLines)
        .where(and(eq(finClearedLines.reconciliationId, rec.id), inArray(finClearedLines.lineId, ids)));
      return;
    }
    const ok = await tx
      .select({ id: finJournalLines.id })
      .from(finJournalLines)
      .innerJoin(finJournalEntries, eq(finJournalEntries.id, finJournalLines.entryId))
      .leftJoin(finClearedLines, eq(finClearedLines.lineId, finJournalLines.id))
      .where(
        and(
          inArray(finJournalLines.id, ids),
          eq(finJournalLines.accountId, rec.glAccountId),
          sql`${finJournalEntries.voidedAt} is null`,
          sql`${finJournalEntries.entryDate} <= ${rec.statementEndDate}::date`,
          sql`(${finClearedLines.lineId} is null or ${finClearedLines.reconciliationId} = ${rec.id})`
        )
      );
    if (ok.length !== ids.length) {
      throw new DalError("INVALID", "Some of those lines changed. Refresh the page and try again.");
    }
    await tx
      .insert(finClearedLines)
      .values(ids.map((lineId) => ({ lineId, reconciliationId: rec.id })))
      .onConflictDoNothing();
  });
}

export async function completeReconciliation(ctx: SessionContext, input: unknown): Promise<{ clearedCount: number }> {
  await requireFinance(ctx, "edit");
  const v = reconciliationIdSchema.parse(input);
  return db.transaction(async (tx) => {
    const rec = await lockInProgress(tx, v.reconciliationId);
    const acct = await accountType(tx, rec.glAccountId);
    const r = await tx.execute<{ d: string; c: string; n: string }>(sql`
      select coalesce(sum(l.debit_cents), 0)::text as d, coalesce(sum(l.credit_cents), 0)::text as c, count(*)::text as n
      from fin_cleared_lines cl
      join fin_journal_lines l on l.id = cl.line_id
      join fin_journal_entries e on e.id = l.entry_id
      where cl.reconciliation_id = ${rec.id}::uuid and e.voided_at is null
    `);
    const cleared = signed(acct.type as FinAccountType, Number(r.rows[0].d), Number(r.rows[0].c));
    const diff = rec.statementEndingBalanceCents - (rec.beginningBalanceCents + cleared);
    if (diff !== 0) {
      const amt = (Math.abs(diff) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
      throw new DalError("INVALID", `The difference must be $0.00 to finish. You are off by ${diff < 0 ? "-" : ""}${amt}.`);
    }
    await tx
      .update(finReconciliations)
      .set({ status: "completed", completedByUserId: ctx.userId, completedAt: new Date() })
      .where(eq(finReconciliations.id, rec.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.reconciliation_completed",
        targetType: "fin_reconciliation",
        targetId: rec.id,
        metadata: { account: `${acct.code} ${acct.name}`, statementEndDate: rec.statementEndDate, endingBalanceCents: rec.statementEndingBalanceCents, cleared: Number(r.rows[0].n) },
      },
      tx
    );
    return { clearedCount: Number(r.rows[0].n) };
  });
}

export async function discardReconciliation(ctx: SessionContext, input: unknown): Promise<void> {
  await requireFinance(ctx, "edit");
  const v = reconciliationIdSchema.parse(input);
  await db.transaction(async (tx) => {
    const rec = await lockInProgress(tx, v.reconciliationId);
    const acct = await accountType(tx, rec.glAccountId);
    const deleted = await tx
      .delete(finClearedLines)
      .where(eq(finClearedLines.reconciliationId, rec.id))
      .returning({ lineId: finClearedLines.lineId });
    await tx.delete(finReconciliations).where(eq(finReconciliations.id, rec.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.reconciliation_discarded",
        targetType: "fin_reconciliation",
        targetId: rec.id,
        metadata: { account: `${acct.code} ${acct.name}`, statementEndDate: rec.statementEndDate, cleared: deleted.length },
      },
      tx
    );
  });
}
