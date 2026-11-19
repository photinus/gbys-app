import "server-only";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  finAccounts,
  finBankAccounts,
  finBankTransactions,
  finFunds,
  finJournalEntries,
  finJournalLines,
  paymentEvents,
  programs,
  users,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  EDITABLE_SOURCES,
  JOURNAL_PAGE_SIZE,
  listEntriesSchema,
  manualEntrySchema,
  openingBalancesSchema,
  replaceEntrySchema,
  voidEntrySchema,
  type ListEntriesInput,
  type ManualEntryInput,
  type OpeningBalancesInput,
} from "@/lib/validation/finance-gl";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import {
  generalFundId,
  postEntry,
  replaceEntry,
  systemAccountId,
  voidEntry,
  type FinAccountType,
  type FinEntrySource,
  type PostEntryInput,
  type PostLineInput,
} from "./finance-ledger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ---- Reads -----------------------------------------------------------------

export interface JournalListRow {
  id: string;
  entryNumber: number;
  entryDate: string;
  memo: string;
  source: FinEntrySource;
  totalCents: number;
  lineCount: number;
  voidedAt: Date | null;
  voidReason: string | null;
  replacedByNumber: number | null;
}

export interface JournalPage {
  rows: JournalListRow[];
  /** Pass as `cursor` for the next (older) page; null when this is the last page. */
  nextCursor: number | null;
}

export async function listJournalEntries(ctx: SessionContext, input: ListEntriesInput = {}): Promise<JournalPage> {
  await requireFinance(ctx, "view_all");
  const f = listEntriesSchema.parse(input);
  const conds: SQL[] = [sql`true`];
  if (f.from) conds.push(sql`e.entry_date >= ${f.from}::date`);
  if (f.to) conds.push(sql`e.entry_date <= ${f.to}::date`);
  if (f.source) conds.push(sql`e.source::text = ${f.source}`);
  if (f.accountId) {
    conds.push(sql`exists (select 1 from fin_journal_lines l where l.entry_id = e.id and l.account_id = ${f.accountId}::uuid)`);
  }
  if (f.q) conds.push(sql`e.memo ilike ${`%${escapeLike(f.q)}%`}`);
  if (f.cursor) conds.push(sql`e.entry_number < ${f.cursor}`);

  const res = await db.execute<{
    id: string;
    entry_number: string;
    entry_date: string;
    memo: string;
    source: FinEntrySource;
    voided_at: string | null;
    void_reason: string | null;
    total: string;
    n: string;
    replaced_number: string | null;
  }>(sql`
    select e.id, e.entry_number::text, e.entry_date::text, e.memo, e.source, e.voided_at, e.void_reason,
           (select coalesce(sum(l.debit_cents), 0)::text from fin_journal_lines l where l.entry_id = e.id) as total,
           (select count(*)::text from fin_journal_lines l where l.entry_id = e.id) as n,
           r.entry_number::text as replaced_number
    from fin_journal_entries e
    left join fin_journal_entries r on r.id = e.replaced_by_entry_id
    where ${sql.join(conds, sql` and `)}
    order by e.entry_number desc
    limit ${JOURNAL_PAGE_SIZE + 1}
  `);
  const more = res.rows.length > JOURNAL_PAGE_SIZE;
  const rows = res.rows.slice(0, JOURNAL_PAGE_SIZE).map((r) => ({
    id: r.id,
    entryNumber: Number(r.entry_number),
    entryDate: r.entry_date,
    memo: r.memo,
    source: r.source,
    totalCents: Number(r.total),
    lineCount: Number(r.n),
    voidedAt: r.voided_at ? new Date(r.voided_at) : null,
    voidReason: r.void_reason,
    replacedByNumber: r.replaced_number ? Number(r.replaced_number) : null,
  }));
  return { rows, nextCursor: more ? rows[rows.length - 1].entryNumber : null };
}

export interface EntryLineView {
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: FinAccountType;
  fundId: string;
  fundName: string;
  programId: string | null;
  programName: string | null;
  debitCents: number;
  creditCents: number;
  description: string | null;
}

export interface EntryDetail {
  id: string;
  entryNumber: number;
  entryDate: string;
  memo: string;
  source: FinEntrySource;
  sourceRef: string | null;
  createdAt: Date;
  createdByName: string | null;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
  replacedBy: { id: string; entryNumber: number } | null;
  replaces: { id: string; entryNumber: number } | null;
  lines: EntryLineView[];
  totalCents: number;
  /** Where this entry came from, when we can link to it. */
  links: { label: string; href: string }[];
  /** Bank feed transactions this entry accounts for. */
  bankTransactions: { id: string; postedDate: string; description: string; amountCents: number; accountName: string }[];
  /** Whether the journal screen may edit it in place (replace). */
  editable: boolean;
}

export async function getJournalEntry(ctx: SessionContext, id: string): Promise<EntryDetail> {
  await requireFinance(ctx, "view_all");
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", "Journal entry not found.");
  const [e] = await db
    .select()
    .from(finJournalEntries)
    .where(eq(finJournalEntries.id, id))
    .limit(1);
  if (!e) throw new DalError("NOT_FOUND", "Journal entry not found.");

  const [lines, names, replacedBy, replaces, txns] = await Promise.all([
    db
      .select({
        lineNo: finJournalLines.lineNo,
        accountId: finJournalLines.accountId,
        accountCode: finAccounts.code,
        accountName: finAccounts.name,
        accountType: finAccounts.type,
        fundId: finJournalLines.fundId,
        fundName: finFunds.name,
        programId: finJournalLines.programId,
        programName: programs.name,
        debitCents: finJournalLines.debitCents,
        creditCents: finJournalLines.creditCents,
        description: finJournalLines.description,
      })
      .from(finJournalLines)
      .innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId))
      .innerJoin(finFunds, eq(finFunds.id, finJournalLines.fundId))
      .leftJoin(programs, eq(programs.id, finJournalLines.programId))
      .where(eq(finJournalLines.entryId, id))
      .orderBy(asc(finJournalLines.lineNo)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [e.createdByUserId, e.voidedByUserId].filter((x): x is string => !!x))),
    e.replacedByEntryId
      ? db
          .select({ id: finJournalEntries.id, entryNumber: finJournalEntries.entryNumber })
          .from(finJournalEntries)
          .where(eq(finJournalEntries.id, e.replacedByEntryId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ id: finJournalEntries.id, entryNumber: finJournalEntries.entryNumber })
      .from(finJournalEntries)
      .where(eq(finJournalEntries.replacedByEntryId, id))
      .limit(1),
    db
      .select({
        id: finBankTransactions.id,
        postedDate: finBankTransactions.postedDate,
        description: finBankTransactions.description,
        amountCents: finBankTransactions.amountCents,
        accountName: finBankAccounts.name,
      })
      .from(finBankTransactions)
      .innerJoin(finBankAccounts, eq(finBankAccounts.id, finBankTransactions.bankAccountId))
      .where(eq(finBankTransactions.journalEntryId, id)),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));

  const links: { label: string; href: string }[] = [];
  if ((e.source === "registration" || e.source === "platform_fee") && e.sourceRef && UUID_RE.test(e.sourceRef)) {
    const [p] = await db
      .select({ slug: programs.slug, name: programs.name })
      .from(paymentEvents)
      .innerJoin(programs, eq(programs.id, paymentEvents.programId))
      .where(eq(paymentEvents.id, e.sourceRef))
      .limit(1);
    if (p) links.push({ label: `Payments for ${p.name}`, href: `/programs/${p.slug}/payments/ledger` });
  }
  if (e.source === "stripe_payout" || e.source === "stripe_fee") links.push({ label: "Stripe payouts", href: "/finance/stripe" });
  if (txns.length) links.push({ label: "Bank inbox", href: "/finance/banking" });

  return {
    id: e.id,
    entryNumber: e.entryNumber,
    entryDate: e.entryDate,
    memo: e.memo,
    source: e.source,
    sourceRef: e.sourceRef,
    createdAt: e.createdAt,
    createdByName: e.createdByUserId ? (nameOf.get(e.createdByUserId) ?? null) : null,
    voidedAt: e.voidedAt,
    voidedByName: e.voidedByUserId ? (nameOf.get(e.voidedByUserId) ?? null) : null,
    voidReason: e.voidReason,
    replacedBy: replacedBy[0] ?? null,
    replaces: replaces[0] ?? null,
    lines,
    totalCents: lines.reduce((s, l) => s + l.debitCents, 0),
    links,
    bankTransactions: txns,
    editable: !e.voidedAt && (EDITABLE_SOURCES as readonly string[]).includes(e.source),
  };
}

export async function listOpeningBalanceEntries(
  ctx: SessionContext
): Promise<{ id: string; entryNumber: number; entryDate: string; memo: string }[]> {
  await requireFinance(ctx, "view_all");
  return db
    .select({
      id: finJournalEntries.id,
      entryNumber: finJournalEntries.entryNumber,
      entryDate: finJournalEntries.entryDate,
      memo: finJournalEntries.memo,
    })
    .from(finJournalEntries)
    .where(and(eq(finJournalEntries.source, "opening_balance"), isNull(finJournalEntries.voidedAt)))
    .orderBy(asc(finJournalEntries.entryNumber));
}

// ---- Writes ----------------------------------------------------------------

async function assertProgramsExist(tx: DbTx, programIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(programIds.filter((p): p is string => !!p))];
  if (!ids.length) return;
  const rows = await tx.select({ id: programs.id }).from(programs).where(inArray(programs.id, ids));
  if (rows.length !== ids.length) throw new DalError("INVALID", "Program not found.");
}

function toPostLines(lines: ManualEntryInputParsed["lines"]): PostLineInput[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    fundId: l.fundId,
    programId: l.programId,
    debitCents: l.debitCents,
    creditCents: l.creditCents,
    description: l.description,
  }));
}
type ManualEntryInputParsed = ReturnType<typeof manualEntrySchema.parse>;

function entryMeta(posted: { entryNumber: number }, input: { entryDate: string; memo: string }, lines: PostLineInput[]) {
  return {
    entryNumber: posted.entryNumber,
    entryDate: input.entryDate,
    memo: input.memo.slice(0, 120),
    lineCount: lines.length,
    totalCents: lines.reduce((s, l) => s + (l.debitCents ?? 0), 0),
  };
}

/** Post a manual journal entry (`edit`). */
export async function postManualEntry(
  ctx: SessionContext,
  input: ManualEntryInput
): Promise<{ entryId: string; entryNumber: number }> {
  await requireFinance(ctx, "edit");
  const d = manualEntrySchema.parse(input);
  return db.transaction(async (tx) => {
    await assertProgramsExist(tx, d.lines.map((l) => l.programId));
    const lines = toPostLines(d.lines);
    const posted = await postEntry(tx, {
      entryDate: d.entryDate,
      memo: d.memo,
      source: "manual",
      createdByUserId: ctx.userId,
      lines,
    });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.entry_posted",
        targetType: "fin_entry",
        targetId: posted.entryId,
        metadata: { source: "manual", ...entryMeta(posted, d, lines) },
      },
      tx
    );
    return { entryId: posted.entryId, entryNumber: posted.entryNumber };
  });
}

/** Opening balances helper (`edit`): balance-sheet accounts only; the offset goes to net assets per fund. */
export async function postOpeningBalances(
  ctx: SessionContext,
  input: OpeningBalancesInput
): Promise<{ entryId: string; entryNumber: number }> {
  await requireFinance(ctx, "edit");
  const d = openingBalancesSchema.parse(input);
  return db.transaction(async (tx) => {
    const general = await generalFundId(tx);
    const rows = d.rows.filter((r) => r.amountCents !== 0);
    if (rows.length === 0) throw new DalError("INVALID", "Enter at least one balance that isn't zero.");

    const accts = await tx
      .select({ id: finAccounts.id, type: finAccounts.type, name: finAccounts.name })
      .from(finAccounts)
      .where(inArray(finAccounts.id, [...new Set(rows.map((r) => r.accountId))]));
    const acctById = new Map(accts.map((a) => [a.id, a]));
    const fundIds = [...new Set(rows.map((r) => r.fundId ?? general))];
    const funds = await tx
      .select({ id: finFunds.id, restriction: finFunds.restriction })
      .from(finFunds)
      .where(inArray(finFunds.id, fundIds));
    const fundById = new Map(funds.map((f) => [f.id, f]));

    const lines: PostLineInput[] = [];
    const netByFund = new Map<string, number>(); // debits - credits
    for (const r of rows) {
      const a = acctById.get(r.accountId);
      if (!a) throw new DalError("INVALID", "Unknown account.");
      if (a.type !== "asset" && a.type !== "liability") {
        throw new DalError("INVALID", `"${a.name}" isn't a balance-sheet account. Opening balances are for things we own and owe.`);
      }
      const fundId = r.fundId ?? general;
      if (!fundById.has(fundId)) throw new DalError("INVALID", "Unknown fund.");
      const debitNormal = a.type === "asset";
      const isDebit = debitNormal ? r.amountCents > 0 : r.amountCents < 0;
      const abs = Math.abs(r.amountCents);
      lines.push({
        accountId: r.accountId,
        fundId,
        debitCents: isDebit ? abs : 0,
        creditCents: isDebit ? 0 : abs,
        description: "Opening balance",
      });
      netByFund.set(fundId, (netByFund.get(fundId) ?? 0) + (isDebit ? abs : -abs));
    }
    const unrestrictedNA = await systemAccountId(tx, "net_assets_unrestricted");
    const restrictedNA = await systemAccountId(tx, "net_assets_restricted");
    for (const [fundId, net] of netByFund) {
      if (net === 0) continue;
      const na = fundById.get(fundId)!.restriction === "with_donor_restrictions" ? restrictedNA : unrestrictedNA;
      lines.push({
        accountId: na,
        fundId,
        debitCents: net < 0 ? -net : 0,
        creditCents: net > 0 ? net : 0,
        description: "Opening net assets",
      });
    }
    const memo = d.memo.trim() || "Opening balances";
    const posted = await postEntry(tx, {
      entryDate: d.asOfDate,
      memo,
      source: "opening_balance",
      createdByUserId: ctx.userId,
      lines,
    });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.entry_posted",
        targetType: "fin_entry",
        targetId: posted.entryId,
        metadata: { source: "opening_balance", ...entryMeta(posted, { entryDate: d.asOfDate, memo }, lines) },
      },
      tx
    );
    return { entryId: posted.entryId, entryNumber: posted.entryNumber };
  });
}

/**
 * "Edit" a manual / opening-balance entry (`edit`): the old entry is voided (with the reason)
 * and the corrected one is posted and linked. Entries from other sources are fixed at their source.
 */
export async function replaceManualEntry(
  ctx: SessionContext,
  input: ManualEntryInput & { entryId: string; reason: string }
): Promise<{ entryId: string; entryNumber: number }> {
  await requireFinance(ctx, "edit");
  const d = replaceEntrySchema.parse(input);
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(finJournalEntries)
      .where(eq(finJournalEntries.id, d.entryId))
      .for("update")
      .limit(1);
    if (!old) throw new DalError("NOT_FOUND", "Journal entry not found.");
    if (old.voidedAt) throw new DalError("INVALID", "This entry is already voided.");
    if (!(EDITABLE_SOURCES as readonly string[]).includes(old.source)) {
      throw new DalError("INVALID", "This entry was created automatically. Fix it where it came from, or void it.");
    }
    await assertProgramsExist(tx, d.lines.map((l) => l.programId));
    const lines = toPostLines(d.lines);
    const replacement: PostEntryInput = {
      entryDate: d.entryDate,
      memo: d.memo,
      source: old.source,
      createdByUserId: ctx.userId,
      lines,
    };
    const posted = await replaceEntry(tx, { entryId: d.entryId, userId: ctx.userId, reason: d.reason, replacement });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.entry_replaced",
        targetType: "fin_entry",
        targetId: d.entryId,
        metadata: {
          oldEntryNumber: old.entryNumber,
          newEntryId: posted.entryId,
          reason: d.reason,
          ...entryMeta(posted, d, lines),
        },
      },
      tx
    );
    return { entryId: posted.entryId, entryNumber: posted.entryNumber };
  });
}

/** Void any live entry (`edit`). Bank transactions pointing at it go back to the inbox. */
export async function voidJournalEntry(
  ctx: SessionContext,
  input: { entryId: string; reason: string }
): Promise<{ resetBankTransactions: number }> {
  await requireFinance(ctx, "edit");
  const d = voidEntrySchema.parse(input);
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select({ entryNumber: finJournalEntries.entryNumber, source: finJournalEntries.source })
      .from(finJournalEntries)
      .where(eq(finJournalEntries.id, d.entryId))
      .limit(1);
    if (!old) throw new DalError("NOT_FOUND", "Journal entry not found.");
    const { resetBankTxnIds } = await voidEntry(tx, { entryId: d.entryId, userId: ctx.userId, reason: d.reason });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.entry_voided",
        targetType: "fin_entry",
        targetId: d.entryId,
        metadata: {
          entryNumber: old.entryNumber,
          source: old.source,
          reason: d.reason,
          resetBankTransactions: resetBankTxnIds.length,
        },
      },
      tx
    );
    return { resetBankTransactions: resetBankTxnIds.length };
  });
}
