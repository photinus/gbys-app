import "server-only";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx, type DbTx } from "@/db";
import {
  finAccounts,
  finContacts,
  finFunds,
  finGifts,
  finJournalEntries,
  finSettings,
  programs,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { laToday, type IsoDate } from "@/lib/finance/dates";
import {
  GIFT_KIND_LABELS,
  RECEIPT_REQUIRED_CENTS,
  receiptStatusLabel,
  receiptStatusOf,
  type GiftKindValue,
  type ReceiptStatus,
} from "@/lib/finance/receipt-content";
import { centsToDecimal } from "@/lib/finance/report-math";
import {
  GIFTS_PAGE_SIZE,
  GIFT_REVENUE_SUBTYPES,
  giftInputSchema,
  releaseFundSchema,
  voidGiftSchema,
  rangeSchema,
  type GiftData,
  type GiftFilters,
  type GiftInput,
  type ReleaseFundInput,
} from "@/lib/validation/finance-donations";
import { formatDate } from "@/lib/format";
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
import { linkBankTxn, lockBankTxnForPosting, type LockedBankTxn } from "./finance-bank-link";
import { createContact, getContact, type ContactDetail } from "./finance-contacts";
import { generalFundId, postEntry, replaceEntry, sumLines, systemAccountId, voidEntry } from "./finance-ledger";

/**
 * Donations (Finance 2, workstream DN): gifts, donors, restricted-fund releases and the donor report.
 * Every function authorizes with requireFinance and audits. Journal writes go through
 * postEntry / replaceEntry / voidEntry inside db.transaction.
 *
 * Posting (source "donation", sourceRef = gift id):
 *   money    Dr deposit account (General Fund) / Cr revenue account (gift fund + program)
 *   in-kind  Dr in-kind debit account (gift fund + program) / Cr 4070 (gift fund + program)
 * Editing a gift keeps the same fin_gifts row (so its receipt history stays attached) and replaces
 * its journal entry (void + re-post, linked).
 * Fund release (source "fund_release"): Dr 3100 (restricted fund) / Cr 3000 (General Fund).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** ISO-8601 UTC text for a timestamptz expression (avoids driver Date/string differences). */
const isoTs = (expr: string) => `to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ---------------------------------------------------------------------------
// Shared receipt-status SQL (also used by finance-receipts.ts)
// ---------------------------------------------------------------------------

/** Lateral joins giving each gift its latest receipt (same donor) and any later annual statement. */
export const GIFT_RECEIPT_JOINS: SQL = sql.raw(`
  left join lateral (
    select r.method, ${isoTs("r.sent_at")} as at, r.amount_cents, r.deductible_cents
    from fin_receipts r
    where r.kind = 'gift' and r.gift_id = g.id and r.contact_id = g.donor_contact_id
    order by r.sent_at desc, r.id desc limit 1
  ) gr on true
  left join lateral (
    select r.method, ${isoTs("r.sent_at")} as at
    from fin_receipts r
    where r.kind = 'annual' and r.contact_id = g.donor_contact_id
      and r.tax_year = extract(year from g.gift_date)::int and r.sent_at >= g.created_at
    order by r.sent_at desc, r.id desc limit 1
  ) ar on true
`);

/** Gift is receiptable (live, has a donor) and not acknowledged (or the receipt is out of date). */
export const NEEDS_RECEIPT_SQL: SQL = sql.raw(`
  (g.voided_at is null and g.donor_contact_id is not null and (
    (gr.method is null and ar.method is null)
    or (gr.method is not null and (
      gr.amount_cents <> case when g.kind = 'in_kind' then 0 else g.amount_cents end
      or gr.deductible_cents <> case when g.kind = 'in_kind' then 0 else greatest(0, g.amount_cents - g.goods_services_cents) end))))
`);

export interface GiftSqlRow extends Record<string, unknown> {
  id: string;
  gift_date: string;
  amount_cents: number;
  kind: GiftKindValue;
  fund_id: string;
  fund_name: string;
  program_id: string | null;
  program_name: string | null;
  donor_contact_id: string | null;
  donor_name: string | null;
  donor_email: string | null;
  is_anonymous: boolean;
  campaign: string | null;
  reference: string | null;
  goods_services_cents: number;
  in_kind_description: string | null;
  voided_at: string | null;
  gr_method: string | null;
  gr_at: string | null;
  gr_amount: number | null;
  gr_deductible: number | null;
  ar_method: string | null;
  ar_at: string | null;
}

export const GIFT_SELECT: SQL = sql.raw(`
  g.id, g.gift_date::text as gift_date, g.amount_cents, g.kind::text as kind, g.fund_id, f.name as fund_name,
  g.program_id, p.name as program_name, g.donor_contact_id, c.display_name as donor_name, c.email as donor_email,
  g.is_anonymous, g.campaign, g.reference, g.goods_services_cents, g.in_kind_description,
  ${isoTs("g.voided_at")} as voided_at,
  gr.method as gr_method, gr.at as gr_at, gr.amount_cents as gr_amount, gr.deductible_cents as gr_deductible,
  ar.method as ar_method, ar.at as ar_at
`);

export const GIFT_FROM: SQL = sql`
  from fin_gifts g
  join fin_funds f on f.id = g.fund_id
  left join programs p on p.id = g.program_id
  left join fin_contacts c on c.id = g.donor_contact_id
  ${GIFT_RECEIPT_JOINS}
`;

export interface GiftListRow {
  id: string;
  giftDate: IsoDate;
  amountCents: number;
  kind: GiftKindValue;
  kindLabel: string;
  fundId: string;
  fundName: string;
  programName: string | null;
  donorId: string | null;
  donorName: string | null;
  donorEmail: string | null;
  isAnonymous: boolean;
  campaign: string | null;
  reference: string | null;
  goodsServicesCents: number;
  inKindDescription: string | null;
  voided: boolean;
  receipt: ReceiptStatus;
}

export function giftRowFromSql(r: GiftSqlRow): GiftListRow {
  const receipt = receiptStatusOf({
    voided: r.voided_at !== null,
    hasDonor: r.donor_contact_id !== null,
    kind: r.kind,
    amountCents: Number(r.amount_cents),
    goodsServicesCents: Number(r.goods_services_cents),
    giftReceipt: r.gr_method
      ? { method: r.gr_method, at: r.gr_at!, amountCents: Number(r.gr_amount), deductibleCents: Number(r.gr_deductible) }
      : null,
    annualReceipt: r.ar_method ? { method: r.ar_method, at: r.ar_at! } : null,
  });
  return {
    id: r.id,
    giftDate: r.gift_date,
    amountCents: Number(r.amount_cents),
    kind: r.kind,
    kindLabel: GIFT_KIND_LABELS[r.kind],
    fundId: r.fund_id,
    fundName: r.fund_name,
    programName: r.program_name,
    donorId: r.donor_contact_id,
    donorName: r.donor_name,
    donorEmail: r.donor_email,
    isAnonymous: r.is_anonymous,
    campaign: r.campaign,
    reference: r.reference,
    goodsServicesCents: Number(r.goods_services_cents),
    inKindDescription: r.in_kind_description,
    voided: r.voided_at !== null,
    receipt,
  };
}

/** "Not sent" / "Emailed Nov 3, 2026" ... for a gift row. */
export function giftReceiptText(s: ReceiptStatus): string {
  return receiptStatusLabel(s, (iso) => formatDate(iso));
}

function buildGiftConds(f: GiftFilters): SQL[] {
  const conds: SQL[] = [];
  if (!f.includeVoided) conds.push(sql`g.voided_at is null`);
  if (f.from) conds.push(sql`g.gift_date >= ${f.from}::date`);
  if (f.to) conds.push(sql`g.gift_date <= ${f.to}::date`);
  if (f.fundId && UUID_RE.test(f.fundId)) conds.push(sql`g.fund_id = ${f.fundId}::uuid`);
  if (f.donorId && UUID_RE.test(f.donorId)) conds.push(sql`g.donor_contact_id = ${f.donorId}::uuid`);
  if (f.campaign?.trim()) conds.push(sql`lower(g.campaign) = lower(${f.campaign.trim()})`);
  switch (f.receipt) {
    case "needed":
      conds.push(NEEDS_RECEIPT_SQL);
      break;
    case "required":
      conds.push(sql`${NEEDS_RECEIPT_SQL} and g.amount_cents >= ${RECEIPT_REQUIRED_CENTS}`);
      break;
    case "sent":
      conds.push(sql`g.voided_at is null and (gr.method is not null or ar.method is not null)`);
      break;
    case "not_sent":
      conds.push(sql`g.voided_at is null and g.donor_contact_id is not null and gr.method is null and ar.method is null`);
      break;
  }
  return conds;
}

// ---------------------------------------------------------------------------
// Gift list / detail
// ---------------------------------------------------------------------------

export interface GiftListResult {
  rows: GiftListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Totals of the live (non-voided) gifts matching the filters, not just this page. */
  totals: { moneyCents: number; inKindCents: number; count: number };
}

export async function listGifts(ctx: SessionContext, filters: GiftFilters = {}): Promise<GiftListResult> {
  await requireFinance(ctx, "view_all");
  const conds = buildGiftConds(filters);
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const [rows, agg] = await Promise.all([
    db.execute<GiftSqlRow>(sql`
      select ${GIFT_SELECT} ${GIFT_FROM} ${where}
      order by g.gift_date desc, g.created_at desc, g.id
      limit ${GIFTS_PAGE_SIZE} offset ${(page - 1) * GIFTS_PAGE_SIZE}
    `),
    db.execute<{ n: string; money: string; inkind: string }>(sql`
      select count(*)::text as n,
             coalesce(sum(case when g.voided_at is null and g.kind <> 'in_kind' then g.amount_cents end), 0)::text as money,
             coalesce(sum(case when g.voided_at is null and g.kind = 'in_kind' then g.amount_cents end), 0)::text as inkind
      ${GIFT_FROM} ${where}
    `),
  ]);
  const a = agg.rows[0];
  return {
    rows: rows.rows.map(giftRowFromSql),
    total: Number(a.n),
    page,
    pageSize: GIFTS_PAGE_SIZE,
    totals: { moneyCents: Number(a.money), inKindCents: Number(a.inkind), count: Number(a.n) },
  };
}

export interface GiftReceiptSummary {
  /** Live, receiptable gifts with no (current) acknowledgment. */
  needCount: number;
  /** Of those, gifts of $250 or more (written acknowledgment required by the IRS). */
  requiredCount: number;
}

export async function getGiftReceiptSummary(ctx: SessionContext): Promise<GiftReceiptSummary> {
  await requireFinance(ctx, "view_all");
  const r = await db.execute<{ n: string; req: string }>(sql`
    select count(*)::text as n,
           (count(*) filter (where g.amount_cents >= ${RECEIPT_REQUIRED_CENTS}))::text as req
    ${GIFT_FROM} where ${NEEDS_RECEIPT_SQL}
  `);
  return { needCount: Number(r.rows[0].n), requiredCount: Number(r.rows[0].req) };
}

export interface GiftReceiptHistoryRow {
  id: string;
  kind: "gift" | "annual";
  taxYear: number | null;
  method: string;
  sentTo: string | null;
  amountCents: number;
  deductibleCents: number;
  sentAt: Date;
  sentByName: string | null;
}

export interface GiftDetail extends GiftListRow {
  note: string | null;
  donorKind: string | null;
  revenueAccount: { id: string; code: string; name: string };
  depositAccount: { id: string; code: string; name: string } | null;
  inKindDebitAccount: { id: string; code: string; name: string } | null;
  goodsServicesDescription: string | null;
  programId: string | null;
  journalEntryId: string | null;
  journalEntryNumber: number | null;
  createdByName: string | null;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  voidedByName: string | null;
  receipts: GiftReceiptHistoryRow[];
  attachments: FinAttachmentRow[];
  /** The bank-feed transaction this gift was recorded from, if any. */
  bankTxn: { id: string; description: string; postedDate: string } | null;
}

export async function getGift(ctx: SessionContext, id: string): Promise<GiftDetail> {
  await requireFinance(ctx, "view_all");
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", "Gift not found.");
  const res = await db.execute<GiftSqlRow>(sql`select ${GIFT_SELECT} ${GIFT_FROM} where g.id = ${id}::uuid`);
  if (!res.rows[0]) throw new DalError("NOT_FOUND", "Gift not found.");
  const base = giftRowFromSql(res.rows[0]);
  const [g] = await db.select().from(finGifts).where(eq(finGifts.id, id)).limit(1);
  const acctIds = [g.revenueAccountId, g.depositAccountId, g.inKindDebitAccountId].filter((x): x is string => !!x);
  const [accts, donor, entry, createdBy, voidedBy, receipts, attachments, txn] = await Promise.all([
    db.select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name }).from(finAccounts).where(inArray(finAccounts.id, acctIds)),
    g.donorContactId
      ? db.select({ kind: finContacts.kind }).from(finContacts).where(eq(finContacts.id, g.donorContactId)).limit(1)
      : Promise.resolve([]),
    g.journalEntryId
      ? db.select({ n: finJournalEntries.entryNumber }).from(finJournalEntries).where(eq(finJournalEntries.id, g.journalEntryId)).limit(1)
      : Promise.resolve([]),
    db.execute<{ name: string | null }>(sql`select name from users where id = ${g.createdByUserId}`),
    g.voidedByUserId ? db.execute<{ name: string | null }>(sql`select name from users where id = ${g.voidedByUserId}`) : Promise.resolve(null),
    db.execute<{
      id: string;
      kind: "gift" | "annual";
      tax_year: number | null;
      method: string;
      sent_to: string | null;
      amount_cents: number;
      deductible_cents: number;
      sent_at: string;
      by_name: string | null;
    }>(sql`
      select r.id, r.kind::text as kind, r.tax_year, r.method, r.sent_to, r.amount_cents, r.deductible_cents,
             ${sql.raw(isoTs("r.sent_at"))} as sent_at, u.name as by_name
      from fin_receipts r left join users u on u.id = r.sent_by_user_id
      where r.gift_id = ${id}::uuid
         or (r.kind = 'annual' and r.contact_id = ${g.donorContactId}::uuid and r.tax_year = ${Number(g.giftDate.slice(0, 4))})
      order by r.sent_at desc
    `),
    listAttachments(db, "gift", id),
    g.journalEntryId
      ? db.execute<{ id: string; description: string; posted: string }>(sql`
          select id, description, posted_date::text as posted from fin_bank_transactions where journal_entry_id = ${g.journalEntryId}::uuid limit 1`)
      : Promise.resolve(null),
  ]);
  const acct = (aid: string | null) => accts.find((a) => a.id === aid) ?? null;
  return {
    ...base,
    note: g.note,
    donorKind: donor[0]?.kind ?? null,
    revenueAccount: acct(g.revenueAccountId)!,
    depositAccount: acct(g.depositAccountId),
    inKindDebitAccount: acct(g.inKindDebitAccountId),
    goodsServicesDescription: g.goodsServicesDescription,
    programId: g.programId,
    journalEntryId: g.journalEntryId,
    journalEntryNumber: entry[0]?.n ?? null,
    createdByName: createdBy.rows[0]?.name ?? null,
    createdAt: g.createdAt,
    voidedAt: g.voidedAt,
    voidReason: g.voidReason,
    voidedByName: voidedBy?.rows[0]?.name ?? null,
    receipts: receipts.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      taxYear: r.tax_year,
      method: r.method,
      sentTo: r.sent_to,
      amountCents: Number(r.amount_cents),
      deductibleCents: Number(r.deductible_cents),
      sentAt: new Date(r.sent_at),
      sentByName: r.by_name,
    })),
    attachments,
    bankTxn: txn?.rows[0] ? { id: txn.rows[0].id, description: txn.rows[0].description, postedDate: txn.rows[0].posted } : null,
  };
}

/** Raw editable fields of a gift (for the edit form). */
export interface GiftEditValues {
  id: string;
  donorContactId: string | null;
  donorName: string | null;
  giftDate: IsoDate;
  amountCents: number;
  kind: GiftKindValue;
  reference: string | null;
  fundId: string;
  programId: string | null;
  revenueAccountId: string;
  depositAccountId: string | null;
  inKindDebitAccountId: string | null;
  inKindDescription: string | null;
  goodsServicesCents: number;
  goodsServicesDescription: string | null;
  campaign: string | null;
  isAnonymous: boolean;
  note: string | null;
  voided: boolean;
  receiptCount: number;
  /** Amount/account can't change when the gift came from a bank transaction. */
  bankLinked: boolean;
}

export async function getGiftForEdit(ctx: SessionContext, id: string): Promise<GiftEditValues> {
  await requireFinance(ctx, "edit");
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", "Gift not found.");
  const [g] = await db.select().from(finGifts).where(eq(finGifts.id, id)).limit(1);
  if (!g) throw new DalError("NOT_FOUND", "Gift not found.");
  const [donor, rc, bank] = await Promise.all([
    g.donorContactId
      ? db.select({ n: finContacts.displayName }).from(finContacts).where(eq(finContacts.id, g.donorContactId)).limit(1)
      : Promise.resolve([]),
    db.execute<{ n: string }>(sql`select count(*)::text as n from fin_receipts where gift_id = ${id}::uuid`),
    g.journalEntryId
      ? db.execute<{ n: string }>(sql`select count(*)::text as n from fin_bank_transactions where journal_entry_id = ${g.journalEntryId}::uuid`)
      : Promise.resolve(null),
  ]);
  return {
    id: g.id,
    donorContactId: g.donorContactId,
    donorName: donor[0]?.n ?? null,
    giftDate: g.giftDate,
    amountCents: g.amountCents,
    kind: g.kind,
    reference: g.reference,
    fundId: g.fundId,
    programId: g.programId,
    revenueAccountId: g.revenueAccountId,
    depositAccountId: g.depositAccountId,
    inKindDebitAccountId: g.inKindDebitAccountId,
    inKindDescription: g.inKindDescription,
    goodsServicesCents: g.goodsServicesCents,
    goodsServicesDescription: g.goodsServicesDescription,
    campaign: g.campaign,
    isAnonymous: g.isAnonymous,
    note: g.note,
    voided: g.voidedAt !== null,
    receiptCount: Number(rc.rows[0].n),
    bankLinked: Number(bank?.rows[0]?.n ?? 0) > 0,
  };
}

// ---------------------------------------------------------------------------
// Gift form options
// ---------------------------------------------------------------------------

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  systemKey: string | null;
}

export interface GiftFormOptions {
  funds: { id: string; name: string; restricted: boolean; programId: string | null }[];
  programs: { id: string; name: string }[];
  /** Revenue accounts for contributions, grants and fundraising events (money gifts). */
  revenuePrimary: AccountOption[];
  /** Every other revenue account, behind an "Other" option. */
  revenueOther: AccountOption[];
  depositAccounts: AccountOption[];
  inKindDebitAccounts: (AccountOption & { type: string })[];
  campaigns: string[];
  defaults: {
    generalFundId: string;
    revenueAccountId: string;
    undepositedAccountId: string;
    /** The Stripe payout bank account (or Checking). */
    stripeBankAccountId: string;
    inKindDebitAccountId: string;
  };
}

export async function getGiftFormOptions(ctx: SessionContext): Promise<GiftFormOptions> {
  await requireFinance(ctx, "edit");
  const [accts, funds, progs, camps, settings] = await Promise.all([
    db
      .select({
        id: finAccounts.id,
        code: finAccounts.code,
        name: finAccounts.name,
        type: finAccounts.type,
        subtype: finAccounts.subtype,
        systemKey: finAccounts.systemKey,
        isBank: finAccounts.isBank,
      })
      .from(finAccounts)
      .where(eq(finAccounts.isActive, true))
      .orderBy(asc(finAccounts.code)),
    db
      .select({ id: finFunds.id, name: finFunds.name, restriction: finFunds.restriction, programId: finFunds.programId, systemKey: finFunds.systemKey })
      .from(finFunds)
      .where(eq(finFunds.isActive, true))
      .orderBy(asc(finFunds.name)),
    db.select({ id: programs.id, name: programs.name }).from(programs).where(isNull(programs.deletedAt)).orderBy(asc(programs.name)),
    db.execute<{ campaign: string }>(sql`select distinct campaign from fin_gifts where campaign is not null order by campaign limit 100`),
    db.select({ payout: finSettings.stripePayoutAccountId }).from(finSettings).where(eq(finSettings.id, 1)).limit(1),
  ]);
  const opt = (a: (typeof accts)[number]): AccountOption => ({ id: a.id, code: a.code, name: a.name, systemKey: a.systemKey });
  const revenue = accts.filter((a) => a.type === "revenue" && a.systemKey !== "in_kind_contributions");
  const primary = revenue.filter((a) => GIFT_REVENUE_SUBTYPES.includes((a.subtype ?? "").trim().toLowerCase() as (typeof GIFT_REVENUE_SUBTYPES)[number]));
  const sys = (k: string) => accts.find((a) => a.systemKey === k)?.id;
  const general = funds.find((f) => f.systemKey === "general");
  const contributions = sys("contributions");
  const undeposited = sys("undeposited_funds");
  const checking = sys("checking");
  const inKindExpense = sys("in_kind_expense");
  if (!general || !contributions || !undeposited || !checking || !inKindExpense) throw new Error("Finance system accounts are missing (migration 0014 seeds them).");
  return {
    funds: funds.map((f) => ({ id: f.id, name: f.name, restricted: f.restriction === "with_donor_restrictions", programId: f.programId })),
    programs: progs,
    revenuePrimary: primary.map(opt),
    revenueOther: revenue.filter((a) => !primary.includes(a)).map(opt),
    depositAccounts: accts.filter((a) => a.type === "asset" && (a.isBank || a.systemKey === "undeposited_funds" || a.systemKey === "stripe_clearing")).map(opt),
    inKindDebitAccounts: accts.filter((a) => a.type === "expense" || (a.type === "asset" && !a.isBank && !a.systemKey)).map((a) => ({ ...opt(a), type: a.type })),
    campaigns: camps.rows.map((c) => c.campaign),
    defaults: {
      generalFundId: general.id,
      revenueAccountId: contributions,
      undepositedAccountId: undeposited,
      stripeBankAccountId: settings[0]?.payout ?? checking,
      inKindDebitAccountId: inKindExpense,
    },
  };
}

/** Fund names for filter dropdowns (org-wide readers). */
export async function listFundChoices(ctx: SessionContext): Promise<{ id: string; name: string; restricted: boolean }[]> {
  await requireFinance(ctx, "view_all");
  const rows = await db.select({ id: finFunds.id, name: finFunds.name, r: finFunds.restriction }).from(finFunds).orderBy(asc(finFunds.name));
  return rows.map((f) => ({ id: f.id, name: f.name, restricted: f.r === "with_donor_restrictions" }));
}

/** Details for a bank-feed deposit being turned into a gift (`?bankTxn=`). */
export async function getBankTxnPrefill(
  ctx: SessionContext,
  bankTxnId: string
): Promise<{ id: string; date: IsoDate; amountCents: number; description: string; payee: string | null; glAccountId: string } | null> {
  await requireFinance(ctx, "edit");
  if (!UUID_RE.test(bankTxnId)) return null;
  const res = await db.execute<{
    id: string;
    posted: string;
    amount_cents: number;
    description: string;
    payee: string | null;
    gl: string | null;
    status: string;
  }>(sql`
    select bt.id, bt.posted_date::text as posted, bt.amount_cents, bt.description, bt.payee, ba.gl_account_id as gl, bt.status::text as status
    from fin_bank_transactions bt join fin_bank_accounts ba on ba.id = bt.bank_account_id
    where bt.id = ${bankTxnId}::uuid
  `);
  const r = res.rows[0];
  if (!r || r.status !== "new" || r.amount_cents <= 0 || !r.gl) return null;
  return { id: r.id, date: r.posted, amountCents: Number(r.amount_cents), description: r.description, payee: r.payee, glAccountId: r.gl };
}

// ---------------------------------------------------------------------------
// Record / edit / void a gift
// ---------------------------------------------------------------------------

interface Prepared {
  donorId: string | null;
  donorName: string | null;
  fundId: string;
  fundName: string;
  programId: string | null;
  revenueAccountId: string;
  depositAccountId: string | null;
  inKindDebitAccountId: string | null;
  isAnonymous: boolean;
  bankTxn: LockedBankTxn | null;
}

async function resolveDonor(
  ctx: SessionContext,
  tx: DbTx,
  d: GiftData
): Promise<{ id: string | null; name: string | null }> {
  if (d.donorMode === "anonymous") return { id: null, name: null };
  if (d.donorMode === "new") {
    const nd = d.newDonor!;
    const created = await createContact(
      ctx,
      {
        displayName: nd.displayName,
        kind: nd.kind,
        email: nd.email,
        addressLine1: nd.addressLine1 ?? undefined,
        addressLine2: nd.addressLine2 ?? undefined,
        city: nd.city ?? undefined,
        state: nd.state ?? undefined,
        postalCode: nd.postalCode ?? undefined,
        isDonor: true,
      },
      tx
    );
    return { id: created.id, name: nd.displayName };
  }
  const [c] = await tx
    .select({ id: finContacts.id, name: finContacts.displayName, isDonor: finContacts.isDonor })
    .from(finContacts)
    .where(eq(finContacts.id, d.donorContactId!))
    .limit(1);
  if (!c) throw new DalError("INVALID", "That donor was not found.");
  if (!c.isDonor) await tx.update(finContacts).set({ isDonor: true }).where(eq(finContacts.id, c.id));
  return { id: c.id, name: c.name };
}

async function prepareGift(
  ctx: SessionContext,
  tx: DbTx,
  d: GiftData,
  opts: { bankTxnId?: string | null }
): Promise<Prepared> {
  const inKind = d.kind === "in_kind";
  const [fund] = await tx.select().from(finFunds).where(eq(finFunds.id, d.fundId)).limit(1);
  if (!fund || !fund.isActive) throw new DalError("INVALID", "Pick an active fund.");
  let programId = d.programId;
  if (!programId && fund.programId) programId = fund.programId;
  if (programId) {
    const [p] = await tx.select({ id: programs.id }).from(programs).where(and(eq(programs.id, programId), isNull(programs.deletedAt))).limit(1);
    if (!p) throw new DalError("INVALID", "Pick a valid program.");
  }

  const accountOk = async (id: string, what: string, types: string[], extra?: (a: { isBank: boolean; systemKey: string | null }) => boolean) => {
    const [a] = await tx
      .select({ isActive: finAccounts.isActive, type: finAccounts.type, isBank: finAccounts.isBank, systemKey: finAccounts.systemKey })
      .from(finAccounts)
      .where(eq(finAccounts.id, id))
      .limit(1);
    if (!a || !a.isActive || !types.includes(a.type) || (extra && !extra(a))) throw new DalError("INVALID", `Pick an active ${what}.`);
  };

  let revenueAccountId: string;
  let depositAccountId: string | null = null;
  let inKindDebitAccountId: string | null = null;
  let bankTxn: LockedBankTxn | null = null;
  if (inKind) {
    revenueAccountId = await systemAccountId(tx, "in_kind_contributions");
    inKindDebitAccountId = d.inKindDebitAccountId ?? (await systemAccountId(tx, "in_kind_expense"));
    await accountOk(inKindDebitAccountId, "account for the in-kind gift", ["expense", "asset"]);
  } else {
    revenueAccountId = d.revenueAccountId ?? (await systemAccountId(tx, "contributions"));
    await accountOk(revenueAccountId, "revenue category", ["revenue"]);
    if (opts.bankTxnId) {
      bankTxn = await lockBankTxnForPosting(tx, opts.bankTxnId);
      if (bankTxn.amountCents <= 0) throw new DalError("INVALID", "Only a deposit (money in) can be recorded as a gift.");
      if (bankTxn.amountCents !== d.amountCents) {
        throw new DalError("INVALID", `The gift amount must match the bank deposit (${money(bankTxn.amountCents)}).`);
      }
      depositAccountId = bankTxn.glAccountId;
    } else if (d.depositAccountId) {
      depositAccountId = d.depositAccountId;
    } else if (d.kind === "cash" || d.kind === "check") {
      depositAccountId = await systemAccountId(tx, "undeposited_funds");
    } else {
      const [s] = await tx.select({ payout: finSettings.stripePayoutAccountId }).from(finSettings).where(eq(finSettings.id, 1)).limit(1);
      depositAccountId = s?.payout ?? (await systemAccountId(tx, "checking"));
    }
    await accountOk(depositAccountId, "deposit account", ["asset"], (a) => a.isBank || a.systemKey === "undeposited_funds" || a.systemKey === "stripe_clearing");
  }

  const donor = await resolveDonor(ctx, tx, d);
  return {
    donorId: donor.id,
    donorName: donor.name,
    fundId: fund.id,
    fundName: fund.name,
    programId,
    revenueAccountId,
    depositAccountId,
    inKindDebitAccountId,
    isAnonymous: d.donorMode === "anonymous" ? true : d.isAnonymous,
    bankTxn,
  };
}

function giftMemo(d: GiftData, donorName: string | null): string {
  const who = donorName ?? "anonymous donor";
  if (d.kind === "in_kind") return `In-kind gift from ${who}: ${d.inKindDescription ?? "donated goods or services"}`.slice(0, 500);
  const how = d.kind === "check" && d.reference ? ` (check #${d.reference})` : d.reference ? ` (ref. ${d.reference})` : "";
  return `Gift from ${who}${how}`.slice(0, 500);
}

function giftLines(p: Prepared, d: GiftData, general: string) {
  if (d.kind === "in_kind") {
    return [
      { accountId: p.inKindDebitAccountId!, fundId: p.fundId, programId: p.programId, debitCents: d.amountCents, description: d.inKindDescription },
      { accountId: p.revenueAccountId, fundId: p.fundId, programId: p.programId, creditCents: d.amountCents, description: d.inKindDescription },
    ];
  }
  return [
    { accountId: p.depositAccountId!, fundId: general, programId: null, debitCents: d.amountCents },
    { accountId: p.revenueAccountId, fundId: p.fundId, programId: p.programId, creditCents: d.amountCents },
  ];
}

function giftColumns(d: GiftData, p: Prepared) {
  return {
    donorContactId: p.donorId,
    giftDate: d.giftDate,
    amountCents: d.amountCents,
    kind: d.kind,
    fundId: p.fundId,
    programId: p.programId,
    revenueAccountId: p.revenueAccountId,
    depositAccountId: p.depositAccountId,
    inKindDebitAccountId: p.inKindDebitAccountId,
    inKindDescription: d.kind === "in_kind" ? d.inKindDescription : null,
    goodsServicesCents: d.goodsServicesCents,
    goodsServicesDescription: d.goodsServicesCents > 0 ? d.goodsServicesDescription : null,
    campaign: d.campaign,
    reference: d.reference,
    isAnonymous: p.isAnonymous,
    note: d.note,
  };
}

/**
 * Record a gift and post its journal entry. `files` (check images etc.) are stored as attachments.
 * With `bankTxnId` (money gifts only) the deposit comes straight from a bank-feed transaction.
 */
export async function recordGift(ctx: SessionContext, input: GiftInput, files: File[] = []): Promise<{ id: string; entryId: string }> {
  await requireFinance(ctx, "edit");
  const d = giftInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const p = await prepareGift(ctx, tx, d, { bankTxnId: d.bankTxnId });
    const general = await generalFundId(tx);
    const [row] = await tx
      .insert(finGifts)
      .values({ ...giftColumns(d, p), createdByUserId: ctx.userId })
      .returning({ id: finGifts.id });
    const posted = await postEntry(tx, {
      entryDate: d.giftDate,
      memo: giftMemo(d, p.donorName),
      source: "donation",
      sourceRef: row.id,
      createdByUserId: ctx.userId,
      lines: giftLines(p, d, general),
    });
    await tx.update(finGifts).set({ journalEntryId: posted.entryId }).where(eq(finGifts.id, row.id));
    if (p.bankTxn) await linkBankTxn(tx, { bankTxnId: p.bankTxn.id, entryId: posted.entryId, userId: ctx.userId });
    for (const file of files) {
      const att = await storeAttachment(tx, { ownerType: "gift", ownerId: row.id, file, userId: ctx.userId });
      await writeAudit(
        { actorUserId: ctx.userId, action: "finance.attachment_added", targetType: "fin_attachment", targetId: att.id, metadata: { ownerType: "gift", giftId: row.id } },
        tx
      );
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.gift_recorded",
        targetType: "fin_gift",
        targetId: row.id,
        metadata: {
          amountCents: d.amountCents,
          kind: d.kind,
          donorId: p.donorId,
          fundId: p.fundId,
          entryNumber: posted.entryNumber,
          bankTxnId: p.bankTxn?.id ?? null,
          anonymous: p.donorId === null,
        },
      },
      tx
    );
    return { id: row.id, entryId: posted.entryId };
  });
}

/**
 * Edit a gift = replace its journal entry (void + re-post, linked) and update the same gift row, so
 * its receipt history stays attached. Receipts sent before the change show as "out of date".
 */
export async function updateGift(ctx: SessionContext, giftId: string, input: GiftInput): Promise<{ id: string; entryId: string }> {
  await requireFinance(ctx, "edit");
  const d = giftInputSchema.parse({ ...input, bankTxnId: undefined });
  if (!UUID_RE.test(giftId)) throw new DalError("NOT_FOUND", "Gift not found.");
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(finGifts).where(eq(finGifts.id, giftId)).for("update").limit(1);
    if (!g) throw new DalError("NOT_FOUND", "Gift not found.");
    if (g.voidedAt) throw new DalError("INVALID", "This gift was voided and can't be edited. Record it again instead.");
    if (!g.journalEntryId) throw new DalError("INVALID", "This gift has no journal entry.");
    if ((g.kind === "in_kind") !== (d.kind === "in_kind")) {
      throw new DalError("INVALID", "A money gift can't be changed into an in-kind gift (or the other way around). Void it and record a new one.");
    }
    const linked = await tx.execute<{ n: string }>(sql`select count(*)::text as n from fin_bank_transactions where journal_entry_id = ${g.journalEntryId}::uuid`);
    const bankLinked = Number(linked.rows[0].n) > 0;
    const p = await prepareGift(ctx, tx, d, {});
    if (bankLinked && (d.amountCents !== g.amountCents || p.depositAccountId !== g.depositAccountId)) {
      throw new DalError(
        "INVALID",
        "This gift was recorded from a bank transaction, so its amount and deposit account can't change here. Void it and record it again."
      );
    }
    const general = await generalFundId(tx);
    const posted = await replaceEntry(tx, {
      entryId: g.journalEntryId,
      userId: ctx.userId,
      reason: "Gift edited",
      replacement: {
        entryDate: d.giftDate,
        memo: giftMemo(d, p.donorName),
        source: "donation",
        sourceRef: g.id,
        createdByUserId: ctx.userId,
        lines: giftLines(p, d, general),
      },
    });
    await tx.update(finGifts).set({ ...giftColumns(d, p), journalEntryId: posted.entryId }).where(eq(finGifts.id, g.id));
    const rc = await tx.execute<{ n: string }>(sql`select count(*)::text as n from fin_receipts where gift_id = ${g.id}::uuid`);
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.gift_updated",
        targetType: "fin_gift",
        targetId: g.id,
        metadata: {
          from: { amountCents: g.amountCents, donorId: g.donorContactId, date: g.giftDate, fundId: g.fundId },
          to: { amountCents: d.amountCents, donorId: p.donorId, date: d.giftDate, fundId: p.fundId },
          entryNumber: posted.entryNumber,
          receiptsAlreadySent: Number(rc.rows[0].n),
        },
      },
      tx
    );
    return { id: g.id, entryId: posted.entryId };
  });
}

/** Void a gift (its entry too). A gift that already has a receipt can be voided; `hadReceipt` is returned so the UI can warn. */
export async function voidGift(ctx: SessionContext, input: { giftId: string; reason: string }): Promise<{ hadReceipt: boolean }> {
  await requireFinance(ctx, "edit");
  const d = voidGiftSchema.parse(input);
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(finGifts).where(eq(finGifts.id, d.giftId)).for("update").limit(1);
    if (!g) throw new DalError("NOT_FOUND", "Gift not found.");
    if (g.voidedAt) throw new DalError("INVALID", "This gift is already voided.");
    const rc = await tx.execute<{ n: string }>(sql`select count(*)::text as n from fin_receipts where gift_id = ${g.id}::uuid`);
    const hadReceipt = Number(rc.rows[0].n) > 0;
    if (g.journalEntryId) await voidEntry(tx, { entryId: g.journalEntryId, userId: ctx.userId, reason: `Gift voided: ${d.reason}` });
    await tx.update(finGifts).set({ voidedAt: new Date(), voidedByUserId: ctx.userId, voidReason: d.reason }).where(eq(finGifts.id, g.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.gift_voided",
        targetType: "fin_gift",
        targetId: g.id,
        metadata: { reason: d.reason, amountCents: g.amountCents, hadReceipt },
      },
      tx
    );
    return { hadReceipt };
  });
}

// ---------------------------------------------------------------------------
// Gift attachments (authorized here; bytes served by the route handler)
// ---------------------------------------------------------------------------

async function assertGiftExists(tx: DbOrTx, giftId: string): Promise<void> {
  if (!UUID_RE.test(giftId)) throw new DalError("NOT_FOUND", "Gift not found.");
  const [g] = await tx.select({ id: finGifts.id }).from(finGifts).where(eq(finGifts.id, giftId)).limit(1);
  if (!g) throw new DalError("NOT_FOUND", "Gift not found.");
}

export async function addGiftAttachment(ctx: SessionContext, giftId: string, file: File): Promise<{ id: string }> {
  await requireFinance(ctx, "edit");
  return db.transaction(async (tx) => {
    await assertGiftExists(tx, giftId);
    const att = await storeAttachment(tx, { ownerType: "gift", ownerId: giftId, file, userId: ctx.userId });
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.attachment_added", targetType: "fin_attachment", targetId: att.id, metadata: { ownerType: "gift", giftId } },
      tx
    );
    return att;
  });
}

export async function removeGiftAttachment(ctx: SessionContext, giftId: string, attachmentId: string): Promise<void> {
  await requireFinance(ctx, "edit");
  await db.transaction(async (tx) => {
    const att = await getAttachment(attachmentId, tx);
    if (!att || att.ownerType !== "gift" || att.ownerId !== giftId) throw new DalError("NOT_FOUND", "Attachment not found.");
    await softDeleteAttachment(tx, att.id, ctx.userId);
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.attachment_removed", targetType: "fin_attachment", targetId: att.id, metadata: { ownerType: "gift", giftId } },
      tx
    );
  });
}

/** Authorized read of a gift attachment's bytes (org-wide finance readers). */
export async function readGiftAttachment(
  ctx: SessionContext,
  giftId: string,
  attachmentId: string
): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
  await requireFinance(ctx, "view_all");
  const att = await getAttachment(attachmentId);
  if (!att || att.ownerType !== "gift" || att.ownerId !== giftId) throw new DalError("NOT_FOUND", "Attachment not found.");
  const obj = await readAttachmentBytes(att.objectKey);
  if (!obj) throw new DalError("NOT_FOUND", "The file is no longer available.");
  return { bytes: obj.body, contentType: att.contentType, fileName: att.fileName };
}

// ---------------------------------------------------------------------------
// Donors
// ---------------------------------------------------------------------------

export interface DonorListRow {
  id: string;
  displayName: string;
  kind: string;
  email: string | null;
  hasEmail: boolean;
  hasAddress: boolean;
  lifetimeCents: number;
  thisYearCents: number;
  lastGiftDate: IsoDate | null;
  giftCount: number;
}

export type DonorSort = "name" | "lifetime" | "recent";

export async function listDonors(
  ctx: SessionContext,
  opts: { q?: string; sort?: DonorSort } = {}
): Promise<{ rows: DonorListRow[]; year: number }> {
  await requireFinance(ctx, "view_all");
  const year = Number(laToday().slice(0, 4));
  const q = opts.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const order =
    opts.sort === "lifetime" ? sql`lifetime desc, c.display_name` : opts.sort === "recent" ? sql`last_gift desc nulls last, c.display_name` : sql`c.display_name`;
  const res = await db.execute<{
    id: string;
    display_name: string;
    kind: string;
    email: string | null;
    address_line1: string | null;
    city: string | null;
    lifetime: string;
    this_year: string;
    last_gift: string | null;
    gift_count: string;
  }>(sql`
    select c.id, c.display_name, c.kind, c.email, c.address_line1, c.city,
           coalesce(sum(case when g.kind <> 'in_kind' then g.amount_cents end), 0)::text as lifetime,
           coalesce(sum(case when g.kind <> 'in_kind' and g.gift_date >= ${`${year}-01-01`}::date and g.gift_date <= ${`${year}-12-31`}::date then g.amount_cents end), 0)::text as this_year,
           max(g.gift_date)::text as last_gift,
           count(g.id)::text as gift_count
    from fin_contacts c
    left join fin_gifts g on g.donor_contact_id = c.id and g.voided_at is null
    where (c.is_donor or exists (select 1 from fin_gifts g2 where g2.donor_contact_id = c.id))
      ${like ? sql`and (c.display_name ilike ${like} or c.email ilike ${like})` : sql``}
    group by c.id
    order by ${order}
    limit 1000
  `);
  return {
    year,
    rows: res.rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      kind: r.kind,
      email: r.email,
      hasEmail: !!r.email,
      hasAddress: !!(r.address_line1 && r.city),
      lifetimeCents: Number(r.lifetime),
      thisYearCents: Number(r.this_year),
      lastGiftDate: r.last_gift,
      giftCount: Number(r.gift_count),
    })),
  };
}

export interface DonorReceiptRow {
  id: string;
  kind: "gift" | "annual";
  giftId: string | null;
  giftDate: IsoDate | null;
  taxYear: number | null;
  method: string;
  sentTo: string | null;
  amountCents: number;
  deductibleCents: number;
  sentAt: Date;
  sentByName: string | null;
}

export interface DonorDetail {
  contact: ContactDetail;
  gifts: GiftListRow[];
  receipts: DonorReceiptRow[];
  byYear: { year: number; moneyCents: number; inKindCents: number; giftCount: number }[];
  lifetimeCents: number;
  inKindLifetimeCents: number;
  needsReceiptCount: number;
}

export async function getDonor(ctx: SessionContext, id: string): Promise<DonorDetail> {
  await requireFinance(ctx, "view_all");
  const contact = await getContact(ctx, id);
  const gifts = await db.execute<GiftSqlRow>(
    sql`select ${GIFT_SELECT} ${GIFT_FROM} where g.donor_contact_id = ${id}::uuid order by g.gift_date desc, g.created_at desc limit 1000`
  );
  const rows = gifts.rows.map(giftRowFromSql);
  if (!contact.isDonor && rows.length === 0) throw new DalError("NOT_FOUND", "Donor not found.");
  const receipts = await db.execute<{
    id: string;
    kind: "gift" | "annual";
    gift_id: string | null;
    gift_date: string | null;
    tax_year: number | null;
    method: string;
    sent_to: string | null;
    amount_cents: number;
    deductible_cents: number;
    sent_at: string;
    by_name: string | null;
  }>(sql`
    select r.id, r.kind::text as kind, r.gift_id, g.gift_date::text as gift_date, r.tax_year, r.method, r.sent_to, r.amount_cents,
           r.deductible_cents, ${sql.raw(isoTs("r.sent_at"))} as sent_at, u.name as by_name
    from fin_receipts r
    left join fin_gifts g on g.id = r.gift_id
    left join users u on u.id = r.sent_by_user_id
    where r.contact_id = ${id}::uuid
    order by r.sent_at desc
    limit 500
  `);
  const years = new Map<number, { year: number; moneyCents: number; inKindCents: number; giftCount: number }>();
  for (const g of rows) {
    if (g.voided) continue;
    const y = Number(g.giftDate.slice(0, 4));
    const s = years.get(y) ?? { year: y, moneyCents: 0, inKindCents: 0, giftCount: 0 };
    if (g.kind === "in_kind") s.inKindCents += g.amountCents;
    else s.moneyCents += g.amountCents;
    s.giftCount += 1;
    years.set(y, s);
  }
  const byYear = [...years.values()].sort((a, b) => b.year - a.year);
  return {
    contact,
    gifts: rows,
    receipts: receipts.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      giftId: r.gift_id,
      giftDate: r.gift_date,
      taxYear: r.tax_year,
      method: r.method,
      sentTo: r.sent_to,
      amountCents: Number(r.amount_cents),
      deductibleCents: Number(r.deductible_cents),
      sentAt: new Date(r.sent_at),
      sentByName: r.by_name,
    })),
    byYear,
    lifetimeCents: byYear.reduce((s, y) => s + y.moneyCents, 0),
    inKindLifetimeCents: byYear.reduce((s, y) => s + y.inKindCents, 0),
    needsReceiptCount: rows.filter((g) => g.receipt.needsReceipt).length,
  };
}

/** Donor picker search (any finance editor): contacts by name or email. */
export async function searchDonors(ctx: SessionContext, q: string): Promise<{ id: string; name: string; email: string | null }[]> {
  await requireFinance(ctx, "edit");
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const res = await db.execute<{ id: string; name: string; email: string | null }>(sql`
    select id, display_name as name, email from fin_contacts
    where is_active and (display_name ilike ${like} or email ilike ${like})
    order by is_donor desc, display_name limit 15
  `);
  return res.rows;
}

// ---------------------------------------------------------------------------
// Restricted funds and releases
// ---------------------------------------------------------------------------

export interface RestrictedFundRow {
  fundId: string;
  name: string;
  programId: string | null;
  programName: string | null;
  purpose: string | null;
  isActive: boolean;
  /** Donor-restricted revenue given to the fund. */
  raisedCents: number;
  /** Spending charged to the fund (released automatically as it is spent). */
  spentCents: number;
  /** Money released by hand to the General Fund. */
  releasedCents: number;
  /** Opening balances and other net-asset lines posted to the fund (excluding releases). */
  otherCents: number;
  /** What is still restricted: raised + other - spent - released. */
  balanceCents: number;
}

async function accountTypeMap(tx: DbOrTx): Promise<Map<string, string>> {
  const rows = await tx.select({ id: finAccounts.id, type: finAccounts.type }).from(finAccounts);
  return new Map(rows.map((r) => [r.id, r.type]));
}

/** Balance of one fund from its non-voided lines: revenue + net-asset lines - expenses. */
async function fundBalanceCents(tx: DbOrTx, fundId: string): Promise<number> {
  const [types, rows] = await Promise.all([accountTypeMap(tx), sumLines(tx, { fundId })]);
  let bal = 0;
  for (const r of rows) {
    const t = types.get(r.accountId);
    if (t === "revenue" || t === "net_assets") bal += r.creditCents - r.debitCents;
    else if (t === "expense") bal -= r.debitCents - r.creditCents;
  }
  return bal;
}

export async function listRestrictedFunds(ctx: SessionContext): Promise<RestrictedFundRow[]> {
  await requireFinance(ctx, "view_all");
  const [funds, types, rows, rel, progs] = await Promise.all([
    db.select().from(finFunds).where(eq(finFunds.restriction, "with_donor_restrictions")).orderBy(asc(finFunds.name)),
    accountTypeMap(db),
    sumLines(db, {}),
    db.execute<{ fund_id: string; released: string }>(sql`
      select l.fund_id, coalesce(sum(l.debit_cents - l.credit_cents), 0)::text as released
      from fin_journal_lines l join fin_journal_entries e on e.id = l.entry_id
      where e.source = 'fund_release' and e.voided_at is null group by l.fund_id`),
    db.select({ id: programs.id, name: programs.name }).from(programs),
  ]);
  const released = new Map(rel.rows.map((r) => [r.fund_id, Number(r.released)]));
  const pname = new Map(progs.map((p) => [p.id, p.name]));
  const acc = new Map<string, { rev: number; exp: number; net: number }>();
  for (const r of rows) {
    const t = types.get(r.accountId);
    const s = acc.get(r.fundId) ?? { rev: 0, exp: 0, net: 0 };
    if (t === "revenue") s.rev += r.creditCents - r.debitCents;
    else if (t === "expense") s.exp += r.debitCents - r.creditCents;
    else if (t === "net_assets") s.net += r.creditCents - r.debitCents;
    acc.set(r.fundId, s);
  }
  return funds
    .map((f) => {
      const s = acc.get(f.id) ?? { rev: 0, exp: 0, net: 0 };
      const releasedCents = released.get(f.id) ?? 0;
      const otherCents = s.net + releasedCents; // net-asset lines include the (negative) release debits
      return {
        fundId: f.id,
        name: f.name,
        programId: f.programId,
        programName: f.programId ? (pname.get(f.programId) ?? null) : null,
        purpose: f.purpose,
        isActive: f.isActive,
        raisedCents: s.rev,
        spentCents: s.exp,
        releasedCents,
        otherCents,
        balanceCents: s.rev + s.net - s.exp,
      };
    })
    .filter((f) => f.isActive || f.raisedCents !== 0 || f.balanceCents !== 0 || f.releasedCents !== 0);
}

export interface FundReleaseRow {
  entryId: string;
  entryNumber: number;
  date: IsoDate;
  fundId: string;
  fundName: string;
  amountCents: number;
  reason: string | null;
  byName: string | null;
  voided: boolean;
  voidReason: string | null;
}

export async function listFundReleases(ctx: SessionContext, opts: { fundId?: string } = {}): Promise<FundReleaseRow[]> {
  await requireFinance(ctx, "view_all");
  const fundCond = opts.fundId && UUID_RE.test(opts.fundId) ? sql`and l.fund_id = ${opts.fundId}::uuid` : sql``;
  const res = await db.execute<{
    entry_id: string;
    entry_number: string;
    date: string;
    fund_id: string;
    fund_name: string;
    amount: string;
    reason: string | null;
    by_name: string | null;
    voided_at: string | null;
    void_reason: string | null;
  }>(sql`
    select e.id as entry_id, e.entry_number::text as entry_number, e.entry_date::text as date, l.fund_id, f.name as fund_name,
           l.debit_cents::text as amount, l.description as reason, u.name as by_name,
           ${sql.raw(isoTs("e.voided_at"))} as voided_at, e.void_reason
    from fin_journal_entries e
    join fin_journal_lines l on l.entry_id = e.id and l.debit_cents > 0
    join fin_funds f on f.id = l.fund_id
    left join users u on u.id = e.created_by_user_id
    where e.source = 'fund_release' ${fundCond}
    order by e.entry_date desc, e.entry_number desc
    limit 200
  `);
  return res.rows.map((r) => ({
    entryId: r.entry_id,
    entryNumber: Number(r.entry_number),
    date: r.date,
    fundId: r.fund_id,
    fundName: r.fund_name,
    amountCents: Number(r.amount),
    reason: r.reason,
    byName: r.by_name,
    voided: r.voided_at !== null,
    voidReason: r.void_reason,
  }));
}

/**
 * Release money from a donor-restricted fund to the General Fund (Dr 3100 restricted fund / Cr 3000
 * General Fund). Refused when it would take the fund below zero. Serialized per fund by a row lock.
 */
export async function releaseFunds(ctx: SessionContext, input: ReleaseFundInput): Promise<{ entryId: string; entryNumber: number }> {
  await requireFinance(ctx, "edit");
  const d = releaseFundSchema.parse(input);
  return db.transaction(async (tx) => {
    const [fund] = await tx.select().from(finFunds).where(eq(finFunds.id, d.fundId)).for("update").limit(1);
    if (!fund) throw new DalError("NOT_FOUND", "Fund not found.");
    if (fund.restriction !== "with_donor_restrictions") throw new DalError("INVALID", "Only donor-restricted funds can be released.");
    if (!fund.isActive) throw new DalError("INVALID", "This fund is inactive.");
    const balance = await fundBalanceCents(tx, fund.id);
    if (d.amountCents > balance) {
      throw new DalError("INVALID", `You can release at most ${money(Math.max(0, balance))} from "${fund.name}". That is what is still restricted.`);
    }
    const [restricted, unrestricted, general] = await Promise.all([
      systemAccountId(tx, "net_assets_restricted"),
      systemAccountId(tx, "net_assets_unrestricted"),
      generalFundId(tx),
    ]);
    const ref = crypto.randomUUID();
    const posted = await postEntry(tx, {
      entryDate: d.date,
      memo: `Release from restriction: ${fund.name}`,
      source: "fund_release",
      sourceRef: ref,
      createdByUserId: ctx.userId,
      lines: [
        { accountId: restricted, fundId: fund.id, programId: fund.programId, debitCents: d.amountCents, description: d.reason },
        { accountId: unrestricted, fundId: general, programId: fund.programId, creditCents: d.amountCents, description: d.reason },
      ],
    });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.fund_released",
        targetType: "fin_fund",
        targetId: fund.id,
        metadata: { amountCents: d.amountCents, reason: d.reason, date: d.date, entryNumber: posted.entryNumber, balanceBeforeCents: balance },
      },
      tx
    );
    return { entryId: posted.entryId, entryNumber: posted.entryNumber };
  });
}

// ---------------------------------------------------------------------------
// Donor report
// ---------------------------------------------------------------------------

export interface DonorReportRow {
  /** null = the grouped "Anonymous / no donor" row. */
  donorId: string | null;
  donorName: string;
  giftCount: number;
  moneyCents: number;
  inKindCents: number;
  goodsServicesCents: number;
  /** Deductible total of money gifts (money - goods and services). */
  deductibleCents: number;
  receiptsSent: number;
  receiptsNeeded: number;
}

export interface DonorReport {
  from: IsoDate;
  to: IsoDate;
  rows: DonorReportRow[];
  totals: Omit<DonorReportRow, "donorId" | "donorName">;
}

export async function getDonorReport(ctx: SessionContext, range: { from: string; to: string }): Promise<DonorReport> {
  await requireFinance(ctx, "view_all");
  const r = rangeSchema.parse(range);
  const res = await db.execute<{
    donor_id: string | null;
    donor_name: string | null;
    n: string;
    money: string;
    inkind: string;
    gs: string;
    deductible: string;
    sent: string;
    needed: string;
  }>(sql`
    select g.donor_contact_id as donor_id, max(c.display_name) as donor_name, count(*)::text as n,
           coalesce(sum(case when g.kind <> 'in_kind' then g.amount_cents end), 0)::text as money,
           coalesce(sum(case when g.kind = 'in_kind' then g.amount_cents end), 0)::text as inkind,
           coalesce(sum(g.goods_services_cents), 0)::text as gs,
           coalesce(sum(case when g.kind <> 'in_kind' then greatest(0, g.amount_cents - g.goods_services_cents) end), 0)::text as deductible,
           count(*) filter (where g.donor_contact_id is not null and not ${NEEDS_RECEIPT_SQL})::text as sent,
           count(*) filter (where ${NEEDS_RECEIPT_SQL})::text as needed
    ${GIFT_FROM}
    where g.voided_at is null and g.gift_date >= ${r.from}::date and g.gift_date <= ${r.to}::date
    group by g.donor_contact_id
    order by max(c.display_name) nulls last
  `);
  const rows: DonorReportRow[] = res.rows.map((x) => ({
    donorId: x.donor_id,
    donorName: x.donor_id ? (x.donor_name ?? "Unknown donor") : "Anonymous / no donor on record",
    giftCount: Number(x.n),
    moneyCents: Number(x.money),
    inKindCents: Number(x.inkind),
    goodsServicesCents: Number(x.gs),
    deductibleCents: Number(x.deductible),
    receiptsSent: Number(x.sent),
    receiptsNeeded: Number(x.needed),
  }));
  const sum = (k: keyof Omit<DonorReportRow, "donorId" | "donorName">) => rows.reduce((s, x) => s + x[k], 0);
  return {
    from: r.from,
    to: r.to,
    rows,
    totals: {
      giftCount: sum("giftCount"),
      moneyCents: sum("moneyCents"),
      inKindCents: sum("inKindCents"),
      goodsServicesCents: sum("goodsServicesCents"),
      deductibleCents: sum("deductibleCents"),
      receiptsSent: sum("receiptsSent"),
      receiptsNeeded: sum("receiptsNeeded"),
    },
  };
}

export async function exportDonorReportCsv(ctx: SessionContext, range: { from: string; to: string }): Promise<{ csv: string; filename: string; rowCount: number }> {
  const rep = await getDonorReport(ctx, range);
  const rows = rep.rows.map((r) => [
    r.donorName,
    r.giftCount,
    centsToDecimal(r.moneyCents),
    centsToDecimal(r.inKindCents),
    centsToDecimal(r.goodsServicesCents),
    centsToDecimal(r.deductibleCents),
    r.receiptsSent,
    r.receiptsNeeded,
  ]);
  rows.push([
    "Total",
    rep.totals.giftCount,
    centsToDecimal(rep.totals.moneyCents),
    centsToDecimal(rep.totals.inKindCents),
    centsToDecimal(rep.totals.goodsServicesCents),
    centsToDecimal(rep.totals.deductibleCents),
    rep.totals.receiptsSent,
    rep.totals.receiptsNeeded,
  ]);
  const csv = toCsv(
    ["Donor", "Gifts", "Money given", "In-kind value (not on receipts)", "Goods/services provided", "Deductible total", "Receipts sent", "Receipts needed"],
    rows
  );
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.report_exported",
    targetType: "fin_report",
    targetId: "donors",
    metadata: { report: "donors", from: rep.from, to: rep.to, rows: rep.rows.length },
  });
  return { csv, filename: `finance-donors-${rep.from}_to_${rep.to}.csv`, rowCount: rep.rows.length };
}
