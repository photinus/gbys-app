import "server-only";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { finContacts, finGifts, finReceipts } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sendHtmlEmail } from "@/lib/email";
import { laToday, type IsoDate } from "@/lib/finance/dates";
import {
  buildAnnualStatement,
  buildGiftReceipt,
  type GiftKindValue,
  type ReceiptDoc,
  type ReceiptDonor,
  type ReceiptGiftInput,
  type ReceiptOrg,
  type ReceiptSettings,
} from "@/lib/finance/receipt-content";
import { renderReceiptEmail } from "@/lib/finance/receipt-email";
import { rangeSchema, yearSchema } from "@/lib/validation/finance-donations";
import { formatDate } from "@/lib/format";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import { GIFT_FROM, GIFT_SELECT, NEEDS_RECEIPT_SQL, giftRowFromSql, type GiftListRow, type GiftSqlRow } from "./finance-donations";
import { getBranding } from "./settings";

/**
 * Donation receipts (Finance 2, workstream DN): per-gift receipts, bulk send for unacknowledged
 * gifts, and calendar-year statements. A fin_receipts row is written ONLY after the email call
 * succeeds (or when someone marks a printed / mailed copy). Email HTML is built in
 * src/lib/finance/receipt-email.ts with every value escaped.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BULK_CAP = 500;

// ---- test seam -------------------------------------------------------------

type EmailSender = (args: { to: string; subject: string; html: string }) => Promise<void>;
let emailSender: EmailSender = sendHtmlEmail;
/** Tests only: replace the email sender (null restores the real one). */
export function __setReceiptEmailSenderForTests(fn: EmailSender | null): void {
  emailSender = fn ?? sendHtmlEmail;
}

// ---- shared loaders --------------------------------------------------------

function appBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

interface ReceiptContext {
  org: ReceiptOrg;
  settings: ReceiptSettings;
}

async function loadReceiptContext(tx: DbOrTx, absoluteLogo: boolean): Promise<ReceiptContext> {
  const b = await getBranding();
  const [s] = await tx.execute<{ name: string | null; title: string | null; message: string | null }>(sql`
    select receipt_signer_name as name, receipt_signer_title as title, receipt_message as message from fin_settings where id = 1
  `).then((r) => r.rows);
  return {
    org: {
      name: b.orgName,
      designation: b.legalDesignation,
      ein: b.ein,
      logoUrl: b.logoUrl ? (absoluteLogo ? `${appBaseUrl()}${b.logoUrl}` : b.logoUrl) : null,
    },
    settings: { signerName: s?.name ?? null, signerTitle: s?.title ?? null, message: s?.message ?? null },
  };
}

const donorCols = {
  id: finContacts.id,
  name: finContacts.displayName,
  email: finContacts.email,
  addressLine1: finContacts.addressLine1,
  addressLine2: finContacts.addressLine2,
  city: finContacts.city,
  state: finContacts.state,
  postalCode: finContacts.postalCode,
};

function toDonor(r: { name: string; email: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null }): ReceiptDonor {
  return {
    name: r.name,
    email: r.email,
    addressLine1: r.addressLine1,
    addressLine2: r.addressLine2,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
  };
}

const giftInputOf = (g: typeof finGifts.$inferSelect): ReceiptGiftInput => ({
  id: g.id,
  giftDate: g.giftDate,
  amountCents: g.amountCents,
  kind: g.kind as GiftKindValue,
  inKindDescription: g.inKindDescription,
  goodsServicesCents: g.goodsServicesCents,
  goodsServicesDescription: g.goodsServicesDescription,
  reference: g.reference,
});

function sentVia(method: string): string {
  return method === "email" ? "emailed" : method === "mail" ? "mailed" : "printed";
}

// ---------------------------------------------------------------------------
// Single gift
// ---------------------------------------------------------------------------

export interface GiftReceiptPreview {
  doc: ReceiptDoc;
  giftId: string;
  donorId: string;
  donorEmail: string | null;
  gift: GiftListRow;
}

/** Build (don't send) the receipt for a gift — used by the print page and the send confirmation. */
export async function getGiftReceiptPreview(ctx: SessionContext, giftId: string, opts: { absoluteLogo?: boolean } = {}): Promise<GiftReceiptPreview> {
  await requireFinance(ctx, "view_all");
  return buildGiftPreview(db, giftId, opts.absoluteLogo ?? false);
}

async function buildGiftPreview(tx: DbOrTx, giftId: string, absoluteLogo: boolean): Promise<GiftReceiptPreview> {
  if (!UUID_RE.test(giftId)) throw new DalError("NOT_FOUND", "Gift not found.");
  const [g] = await tx.select().from(finGifts).where(eq(finGifts.id, giftId)).limit(1);
  if (!g) throw new DalError("NOT_FOUND", "Gift not found.");
  if (g.voidedAt) throw new DalError("INVALID", "This gift was voided, so it can't be receipted.");
  if (!g.donorContactId) throw new DalError("INVALID", "This gift has no donor on record, so it can't be receipted.");
  const [donor] = await tx.select(donorCols).from(finContacts).where(eq(finContacts.id, g.donorContactId)).limit(1);
  const ctx = await loadReceiptContext(tx, absoluteLogo);
  const row = await tx.execute<GiftSqlRow>(sql`select ${GIFT_SELECT} ${GIFT_FROM} where g.id = ${giftId}::uuid`);
  return {
    doc: buildGiftReceipt({ ...ctx, donor: toDonor(donor), gift: giftInputOf(g), issuedOn: laToday() }),
    giftId,
    donorId: donor.id,
    donorEmail: donor.email,
    gift: giftRowFromSql(row.rows[0]),
  };
}

/** Insert the fin_receipts row + audit (inside the caller's transaction). */
async function logGiftReceipt(
  ctx: SessionContext,
  tx: DbOrTx,
  p: GiftReceiptPreview,
  method: "email" | "print" | "mail",
  sentTo: string | null
): Promise<string> {
  const [row] = await tx
    .insert(finReceipts)
    .values({
      kind: "gift",
      giftId: p.giftId,
      contactId: p.donorId,
      method,
      sentTo,
      amountCents: p.doc.snapshot.amountCents,
      deductibleCents: p.doc.snapshot.deductibleCents,
      sentByUserId: ctx.userId,
    })
    .returning({ id: finReceipts.id });
  await writeAudit(
    {
      actorUserId: ctx.userId,
      action: "finance.receipt_sent",
      targetType: "fin_receipt",
      targetId: row.id,
      metadata: { kind: "gift", giftId: p.giftId, contactId: p.donorId, method, amountCents: p.doc.snapshot.amountCents },
    },
    tx
  );
  return row.id;
}

async function sendGiftReceiptInternal(ctx: SessionContext, giftId: string, resend: boolean): Promise<{ receiptId: string; sentTo: string }> {
  return db.transaction(async (tx) => {
    // Row lock: two clicks / two bulk runs can't both send the same gift's receipt.
    const locked = await tx.select({ id: finGifts.id }).from(finGifts).where(eq(finGifts.id, giftId)).for("update");
    if (locked.length === 0) throw new DalError("NOT_FOUND", "Gift not found.");
    const p = await buildGiftPreview(tx, giftId, true);
    if (!p.donorEmail) throw new DalError("INVALID", `${p.doc.donor.name} has no email address. Add one on their contact page, or print the receipt instead.`);
    if (!resend && !p.gift.receipt.needsReceipt) {
      throw new DalError("INVALID", "A receipt has already been sent for this gift. Use “Send again” to send another copy.");
    }
    const { subject, html } = renderReceiptEmail(p.doc);
    try {
      await emailSender({ to: p.donorEmail, subject, html });
    } catch (err) {
      console.error("[receipts] email failed", err);
      throw new DalError("INVALID", "The email couldn't be sent, so nothing was recorded. Please try again in a moment.");
    }
    const receiptId = await logGiftReceipt(ctx, tx, p, "email", p.donorEmail);
    return { receiptId, sentTo: p.donorEmail };
  });
}

/** Email a gift's receipt to the donor. Records fin_receipts only after the email call succeeds. */
export async function sendGiftReceipt(ctx: SessionContext, giftId: string, opts: { resend?: boolean } = {}): Promise<{ receiptId: string; sentTo: string }> {
  await requireFinance(ctx, "edit");
  return sendGiftReceiptInternal(ctx, giftId, opts.resend ?? false);
}

/** Record that a receipt was printed or mailed by hand. */
export async function markGiftReceipt(ctx: SessionContext, giftId: string, method: "print" | "mail"): Promise<{ receiptId: string }> {
  await requireFinance(ctx, "edit");
  if (method !== "print" && method !== "mail") throw new DalError("INVALID", "Pick printed or mailed.");
  return db.transaction(async (tx) => {
    await tx.select({ id: finGifts.id }).from(finGifts).where(eq(finGifts.id, giftId)).for("update");
    const p = await buildGiftPreview(tx, giftId, false);
    return { receiptId: await logGiftReceipt(ctx, tx, p, method, null) };
  });
}

// ---------------------------------------------------------------------------
// Bulk: gifts that still need a receipt
// ---------------------------------------------------------------------------

export interface UnacknowledgedPreview {
  from: IsoDate;
  to: IsoDate;
  /** Gifts that can be emailed now (donor has an email). */
  emailable: number;
  /** Gifts whose donor has no email (print these instead). */
  noEmail: number;
  totalCents: number;
  /** First rows, for the preview table. */
  sample: GiftListRow[];
  /** Beyond this many in one run, run it again. */
  cap: number;
}

export async function previewUnacknowledged(ctx: SessionContext, range: { from: string; to: string }): Promise<UnacknowledgedPreview> {
  await requireFinance(ctx, "view_all");
  const r = rangeSchema.parse(range);
  const where = sql`where ${NEEDS_RECEIPT_SQL} and g.gift_date >= ${r.from}::date and g.gift_date <= ${r.to}::date`;
  const [agg, sample] = await Promise.all([
    db.execute<{ emailable: string; no_email: string; total: string }>(sql`
      select count(*) filter (where coalesce(c.email, '') <> '')::text as emailable,
             count(*) filter (where coalesce(c.email, '') = '')::text as no_email,
             coalesce(sum(case when g.kind <> 'in_kind' then g.amount_cents end), 0)::text as total
      ${GIFT_FROM} ${where}`),
    db.execute<GiftSqlRow>(sql`select ${GIFT_SELECT} ${GIFT_FROM} ${where} order by g.gift_date, g.created_at limit 25`),
  ]);
  const a = agg.rows[0];
  return {
    from: r.from,
    to: r.to,
    emailable: Number(a.emailable),
    noEmail: Number(a.no_email),
    totalCents: Number(a.total),
    sample: sample.rows.map(giftRowFromSql),
    cap: BULK_CAP,
  };
}

export interface BulkSendResult {
  attempted: number;
  sent: number;
  skippedNoEmail: number;
  failed: { giftId: string; donorName: string | null; error: string }[];
  /** More gifts remain beyond the per-run cap. */
  more: boolean;
}

/** Email receipts for every unacknowledged gift in the range whose donor has an email. */
export async function sendUnacknowledgedReceipts(ctx: SessionContext, range: { from: string; to: string }): Promise<BulkSendResult> {
  await requireFinance(ctx, "edit");
  const r = rangeSchema.parse(range);
  const res = await db.execute<{ id: string; name: string | null; email: string | null }>(sql`
    select g.id, c.display_name as name, c.email
    ${GIFT_FROM}
    where ${NEEDS_RECEIPT_SQL} and g.gift_date >= ${r.from}::date and g.gift_date <= ${r.to}::date
    order by g.gift_date, g.created_at
  `);
  const withEmail = res.rows.filter((g) => (g.email ?? "").trim() !== "");
  const out: BulkSendResult = {
    attempted: 0,
    sent: 0,
    skippedNoEmail: res.rows.length - withEmail.length,
    failed: [],
    more: withEmail.length > BULK_CAP,
  };
  for (const g of withEmail.slice(0, BULK_CAP)) {
    out.attempted += 1;
    try {
      await sendGiftReceiptInternal(ctx, g.id, false);
      out.sent += 1;
    } catch (e) {
      out.failed.push({ giftId: g.id, donorName: g.name, error: e instanceof DalError ? e.message : "Unexpected error." });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Annual (calendar-year) statements
// ---------------------------------------------------------------------------

export interface AnnualStatementRow {
  contactId: string;
  donorName: string;
  email: string | null;
  giftCount: number;
  moneyCents: number;
  inKindCount: number;
  deductibleCents: number;
  /** Latest annual statement for this donor + year. */
  sent: { method: string; at: Date; sentTo: string | null } | null;
  /** A statement was sent but the gifts changed since. */
  outdated: boolean;
  needsStatement: boolean;
}

export interface AnnualSummary {
  year: number;
  rows: AnnualStatementRow[];
  counts: { donors: number; needing: number; emailable: number; noEmail: number; sent: number };
}

const yearBounds = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

export async function listAnnualStatements(ctx: SessionContext, yearInput: number): Promise<AnnualSummary> {
  await requireFinance(ctx, "view_all");
  const year = yearSchema.parse(yearInput);
  const b = yearBounds(year);
  const res = await db.execute<{
    id: string;
    name: string;
    email: string | null;
    n: string;
    money: string;
    inkind: string;
    deductible: string;
    r_method: string | null;
    r_at: string | null;
    r_to: string | null;
    r_amount: number | null;
    r_deductible: number | null;
  }>(sql`
    select c.id, c.display_name as name, c.email, count(g.id)::text as n,
           coalesce(sum(case when g.kind <> 'in_kind' then g.amount_cents end), 0)::text as money,
           count(*) filter (where g.kind = 'in_kind')::text as inkind,
           coalesce(sum(case when g.kind <> 'in_kind' then greatest(0, g.amount_cents - g.goods_services_cents) end), 0)::text as deductible,
           lr.method as r_method, ${sql.raw(`to_char(lr.sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)} as r_at,
           lr.sent_to as r_to, lr.amount_cents as r_amount, lr.deductible_cents as r_deductible
    from fin_gifts g
    join fin_contacts c on c.id = g.donor_contact_id
    left join lateral (
      select r.method, r.sent_at, r.sent_to, r.amount_cents, r.deductible_cents from fin_receipts r
      where r.kind = 'annual' and r.contact_id = c.id and r.tax_year = ${year}
      order by r.sent_at desc, r.id desc limit 1) lr on true
    where g.voided_at is null and g.gift_date >= ${b.from}::date and g.gift_date <= ${b.to}::date
    group by c.id, lr.method, lr.sent_at, lr.sent_to, lr.amount_cents, lr.deductible_cents
    order by c.display_name
  `);
  const rows: AnnualStatementRow[] = res.rows.map((r) => {
    const money = Number(r.money);
    const deductible = Number(r.deductible);
    const sent = r.r_method ? { method: r.r_method, at: new Date(r.r_at!), sentTo: r.r_to } : null;
    const outdated = !!sent && (Number(r.r_amount) !== money || Number(r.r_deductible) !== deductible);
    return {
      contactId: r.id,
      donorName: r.name,
      email: r.email,
      giftCount: Number(r.n),
      moneyCents: money,
      inKindCount: Number(r.inkind),
      deductibleCents: deductible,
      sent,
      outdated,
      needsStatement: !sent || outdated,
    };
  });
  const needing = rows.filter((r) => r.needsStatement);
  return {
    year,
    rows,
    counts: {
      donors: rows.length,
      needing: needing.length,
      emailable: needing.filter((r) => (r.email ?? "").trim() !== "").length,
      noEmail: needing.filter((r) => (r.email ?? "").trim() === "").length,
      sent: rows.length - needing.length,
    },
  };
}

async function buildAnnualDoc(tx: DbOrTx, contactId: string, year: number, absoluteLogo: boolean): Promise<{ doc: ReceiptDoc; donorEmail: string | null }> {
  if (!UUID_RE.test(contactId)) throw new DalError("NOT_FOUND", "Donor not found.");
  const [donor] = await tx.select(donorCols).from(finContacts).where(eq(finContacts.id, contactId)).limit(1);
  if (!donor) throw new DalError("NOT_FOUND", "Donor not found.");
  const b = yearBounds(year);
  const gifts = await tx
    .select()
    .from(finGifts)
    .where(and(eq(finGifts.donorContactId, contactId), isNull(finGifts.voidedAt), gte(finGifts.giftDate, b.from), lte(finGifts.giftDate, b.to)))
    .orderBy(asc(finGifts.giftDate), asc(finGifts.createdAt));
  if (gifts.length === 0) throw new DalError("INVALID", `${donor.name} has no gifts in ${year}.`);
  const ctx = await loadReceiptContext(tx, absoluteLogo);
  return {
    doc: buildAnnualStatement({ ...ctx, donor: toDonor(donor), taxYear: year, gifts: gifts.map(giftInputOf), issuedOn: laToday() }),
    donorEmail: donor.email,
  };
}

/** Preview one donor's statement (print page / confirmation). */
export async function getAnnualStatementDoc(ctx: SessionContext, contactId: string, yearInput: number): Promise<{ doc: ReceiptDoc; donorEmail: string | null }> {
  await requireFinance(ctx, "view_all");
  return buildAnnualDoc(db, contactId, yearSchema.parse(yearInput), false);
}

export type AnnualPrintFilter = "all" | "needing" | "no_email";

/** All statements for a printable batch (page-break per donor). */
export async function getAnnualPrintBatch(
  ctx: SessionContext,
  yearInput: number,
  filter: AnnualPrintFilter = "all"
): Promise<{ year: number; docs: { contactId: string; doc: ReceiptDoc }[] }> {
  await requireFinance(ctx, "view_all");
  const year = yearSchema.parse(yearInput);
  const summary = await listAnnualStatements(ctx, year);
  let rows = summary.rows;
  if (filter === "needing") rows = rows.filter((r) => r.needsStatement);
  if (filter === "no_email") rows = rows.filter((r) => (r.email ?? "").trim() === "");
  const docs: { contactId: string; doc: ReceiptDoc }[] = [];
  for (const r of rows.slice(0, 1000)) docs.push({ contactId: r.contactId, doc: (await buildAnnualDoc(db, r.contactId, year, false)).doc });
  return { year, docs };
}

async function logAnnualReceipt(
  ctx: SessionContext,
  tx: DbOrTx,
  contactId: string,
  year: number,
  doc: ReceiptDoc,
  method: "email" | "print" | "mail",
  sentTo: string | null
): Promise<string> {
  const [row] = await tx
    .insert(finReceipts)
    .values({
      kind: "annual",
      contactId,
      taxYear: year,
      method,
      sentTo,
      amountCents: doc.snapshot.amountCents,
      deductibleCents: doc.snapshot.deductibleCents,
      sentByUserId: ctx.userId,
    })
    .returning({ id: finReceipts.id });
  await writeAudit(
    {
      actorUserId: ctx.userId,
      action: "finance.receipt_sent",
      targetType: "fin_receipt",
      targetId: row.id,
      metadata: { kind: "annual", taxYear: year, contactId, method, amountCents: doc.snapshot.amountCents, giftCount: doc.totals.giftCount },
    },
    tx
  );
  return row.id;
}

async function sendAnnualInternal(ctx: SessionContext, contactId: string, year: number, resend: boolean): Promise<{ receiptId: string; sentTo: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fin:annual:${contactId}:${year}`}))`);
    const { doc, donorEmail } = await buildAnnualDoc(tx, contactId, year, true);
    if (!donorEmail) throw new DalError("INVALID", `${doc.donor.name} has no email address. Add one on their contact page, or print the statement instead.`);
    if (!resend) {
      const [last] = await tx
        .select({ a: finReceipts.amountCents, d: finReceipts.deductibleCents })
        .from(finReceipts)
        .where(and(eq(finReceipts.kind, "annual"), eq(finReceipts.contactId, contactId), eq(finReceipts.taxYear, year)))
        .orderBy(sql`${finReceipts.sentAt} desc`)
        .limit(1);
      if (last && last.a === doc.snapshot.amountCents && last.d === doc.snapshot.deductibleCents) {
        throw new DalError("INVALID", `A ${year} statement was already sent to ${doc.donor.name}. Use “Send again” to send another copy.`);
      }
    }
    const { subject, html } = renderReceiptEmail(doc);
    try {
      await emailSender({ to: donorEmail, subject, html });
    } catch (err) {
      console.error("[receipts] annual email failed", err);
      throw new DalError("INVALID", "The email couldn't be sent, so nothing was recorded. Please try again in a moment.");
    }
    const receiptId = await logAnnualReceipt(ctx, tx, contactId, year, doc, "email", donorEmail);
    return { receiptId, sentTo: donorEmail };
  });
}

export async function sendAnnualStatement(
  ctx: SessionContext,
  contactId: string,
  yearInput: number,
  opts: { resend?: boolean } = {}
): Promise<{ receiptId: string; sentTo: string }> {
  await requireFinance(ctx, "edit");
  return sendAnnualInternal(ctx, contactId, yearSchema.parse(yearInput), opts.resend ?? false);
}

/** Email the year's statement to every donor that needs one (and has an email). */
export async function sendAllAnnualStatements(ctx: SessionContext, yearInput: number): Promise<BulkSendResult> {
  await requireFinance(ctx, "edit");
  const year = yearSchema.parse(yearInput);
  const summary = await listAnnualStatements(ctx, year);
  const needing = summary.rows.filter((r) => r.needsStatement);
  const withEmail = needing.filter((r) => (r.email ?? "").trim() !== "");
  const out: BulkSendResult = {
    attempted: 0,
    sent: 0,
    skippedNoEmail: needing.length - withEmail.length,
    failed: [],
    more: withEmail.length > BULK_CAP,
  };
  for (const r of withEmail.slice(0, BULK_CAP)) {
    out.attempted += 1;
    try {
      await sendAnnualInternal(ctx, r.contactId, year, false);
      out.sent += 1;
    } catch (e) {
      out.failed.push({ giftId: r.contactId, donorName: r.donorName, error: e instanceof DalError ? e.message : "Unexpected error." });
    }
  }
  return out;
}

/** Record printed / mailed statements for these donors (one fin_receipts row each). */
export async function markAnnualStatements(
  ctx: SessionContext,
  input: { year: number; contactIds: string[]; method: "print" | "mail" }
): Promise<{ marked: number }> {
  await requireFinance(ctx, "edit");
  const year = yearSchema.parse(input.year);
  if (input.method !== "print" && input.method !== "mail") throw new DalError("INVALID", "Pick printed or mailed.");
  const ids = [...new Set(input.contactIds)].slice(0, 1000);
  if (ids.length === 0) throw new DalError("INVALID", "Pick at least one donor.");
  return db.transaction(async (tx) => {
    let marked = 0;
    for (const id of ids) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fin:annual:${id}:${year}`}))`);
      const { doc } = await buildAnnualDoc(tx, id, year, false);
      await logAnnualReceipt(ctx, tx, id, year, doc, input.method, null);
      marked += 1;
    }
    return { marked };
  });
}

export function receiptSentText(method: string, at: Date | string): string {
  return `${sentVia(method)[0].toUpperCase()}${sentVia(method).slice(1)} ${formatDate(at)}`;
}
