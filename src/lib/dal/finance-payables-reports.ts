import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { isIsoDate, laToday, type IsoDate } from "@/lib/finance/dates";
import {
  AGING_BUCKETS,
  AGING_LABELS,
  agingBucket,
  daysBetween,
  type AgingBucket,
} from "@/lib/finance/payables-math";
import { formatDob } from "@/lib/format";
import { DalError, type SessionContext } from "./context";
import { isFinanceAdmin, requireFinance } from "./finance-access";
import { revealTaxId } from "./finance-contacts";
import { getReportMeta, type ReportMeta } from "./finance-reports";

/** A/P aging and 1099 vendor reports (Finance 2, PB). Org-wide readers only. */

export type BucketTotals = Record<AgingBucket, number> & { total: number };

function emptyTotals(): BucketTotals {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
}

export interface ApAgingRow {
  billId: string;
  kind: "bill" | "reimbursement";
  contactId: string;
  contactName: string;
  vendorInvoiceNumber: string | null;
  memo: string;
  billDate: IsoDate;
  dueDate: IsoDate;
  daysPastDue: number;
  bucket: AgingBucket;
  balanceCents: number;
}

export interface ApAgingContact {
  contactId: string;
  contactName: string;
  buckets: BucketTotals;
}

export interface ApAgingReport {
  meta: ReportMeta;
  asOf: IsoDate;
  rows: ApAgingRow[];
  contacts: ApAgingContact[];
  totals: BucketTotals;
}

/**
 * Open bills and reimbursements as of a date, by days past due (due date, else bill date).
 * Balance = total less payments dated on or before the as-of date (void payments ignored).
 */
export async function getApAging(ctx: SessionContext, opts: { asOf?: string } = {}): Promise<ApAgingReport> {
  await requireFinance(ctx, "view_all");
  const meta = await getReportMeta(ctx);
  const asOf = opts.asOf && isIsoDate(opts.asOf) ? opts.asOf : meta.today;
  const res = await db.execute<{
    id: string;
    kind: "bill" | "reimbursement";
    contact_id: string;
    contact_name: string;
    vendor_invoice_number: string | null;
    memo: string;
    bill_date: string;
    due_date: string;
    balance: string;
  }>(sql`
    select b.id, b.kind, b.contact_id, c.display_name as contact_name, b.vendor_invoice_number, b.memo,
           b.bill_date::text as bill_date, coalesce(b.due_date, b.bill_date)::text as due_date,
           (b.total_cents - coalesce((
             select sum(pa.amount_cents) from fin_payment_applications pa
             join fin_payments p on p.id = pa.payment_id
             where pa.bill_id = b.id and p.voided_at is null and p.payment_date <= ${asOf}::date
           ), 0))::text as balance
    from fin_bills b
    join fin_contacts c on c.id = b.contact_id
    where b.status in ('approved', 'partially_paid', 'paid') and b.bill_date <= ${asOf}::date
    order by c.display_name, coalesce(b.due_date, b.bill_date), b.created_at
  `);
  const rows: ApAgingRow[] = [];
  for (const r of res.rows) {
    const balanceCents = Number(r.balance);
    if (balanceCents <= 0) continue;
    rows.push({
      billId: r.id,
      kind: r.kind,
      contactId: r.contact_id,
      contactName: r.contact_name,
      vendorInvoiceNumber: r.vendor_invoice_number,
      memo: r.memo,
      billDate: r.bill_date,
      dueDate: r.due_date,
      daysPastDue: Math.max(daysBetween(r.due_date, asOf), 0),
      bucket: agingBucket(r.due_date, asOf),
      balanceCents,
    });
  }
  const totals = emptyTotals();
  const byContact = new Map<string, ApAgingContact>();
  for (const r of rows) {
    let c = byContact.get(r.contactId);
    if (!c) byContact.set(r.contactId, (c = { contactId: r.contactId, contactName: r.contactName, buckets: emptyTotals() }));
    c.buckets[r.bucket] += r.balanceCents;
    c.buckets.total += r.balanceCents;
    totals[r.bucket] += r.balanceCents;
    totals.total += r.balanceCents;
  }
  return { meta, asOf, rows, contacts: [...byContact.values()], totals };
}

export async function exportApAgingCsv(ctx: SessionContext, opts: { asOf?: string } = {}): Promise<{ csv: string; filename: string }> {
  const r = await getApAging(ctx, opts);
  const csv = toCsv(
    ["Payee", "Type", "Invoice #", "For", "Bill date", "Due date", "Days past due", "Age", "Balance"],
    [
      ...r.rows.map((x) => [
        x.contactName,
        x.kind === "reimbursement" ? "Reimbursement" : "Bill",
        x.vendorInvoiceNumber,
        x.memo,
        x.billDate,
        x.dueDate,
        x.daysPastDue,
        AGING_LABELS[x.bucket],
        (x.balanceCents / 100).toFixed(2),
      ]),
      ["Total", "", "", "", "", "", "", "", (r.totals.total / 100).toFixed(2)],
      ...AGING_BUCKETS.map((b) => [`  ${AGING_LABELS[b]}`, "", "", "", "", "", "", "", (r.totals[b] / 100).toFixed(2)]),
    ]
  );
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.report_exported",
    targetType: "fin_report",
    targetId: "ap-aging",
    metadata: { report: "ap-aging", period: `as of ${r.asOf}`, rowCount: r.rows.length, format: "csv" },
  });
  return { csv, filename: `finance-ap-aging-${r.asOf}.csv` };
}

// ---------------------------------------------------------------------------
// 1099
// ---------------------------------------------------------------------------

/** $600 in cents: the IRS reporting threshold for 1099-NEC / MISC (tax year 2025 and earlier). */
export const FORM_1099_THRESHOLD_CENTS = 60_000;

export interface Vendor1099Row {
  contactId: string;
  name: string;
  kind: string;
  taxIdType: string | null;
  taxIdLast4: string | null;
  hasTaxId: boolean;
  w9ReceivedOn: IsoDate | null;
  /** Reportable payments (everything except card and Stripe). */
  totalCents: number;
  /** Paid by card / Stripe (the processor reports those on a 1099-K). */
  excludedCents: number;
  paymentCount: number;
  flagged: boolean;
}

export interface Report1099 {
  year: number;
  years: number[];
  thresholdCents: number;
  rows: Vendor1099Row[];
  flaggedCount: number;
  missingW9Count: number;
  /** 1099-flagged vendors with no payments that year (not listed). */
  quietVendors: number;
}

export async function get1099Report(ctx: SessionContext, opts: { year?: number } = {}): Promise<Report1099> {
  await requireFinance(ctx, "view_all");
  const thisYear = Number(laToday().slice(0, 4));
  const year = opts.year && Number.isInteger(opts.year) && opts.year >= 2000 && opts.year <= thisYear + 1 ? opts.year : thisYear;
  const res = await db.execute<{
    id: string;
    name: string;
    kind: string;
    tax_id_type: string | null;
    tax_id_last4: string | null;
    has_tax_id: boolean;
    w9: string | null;
    reportable: string;
    excluded: string;
    n: string;
  }>(sql`
    select c.id, c.display_name as name, c.kind, c.tax_id_type, c.tax_id_last4,
           (c.tax_id_ciphertext is not null) as has_tax_id, c.w9_received_on::text as w9,
           coalesce(sum(p.amount_cents) filter (where p.method not in ('card', 'stripe')), 0)::text as reportable,
           coalesce(sum(p.amount_cents) filter (where p.method in ('card', 'stripe')), 0)::text as excluded,
           count(p.id)::text as n
    from fin_contacts c
    left join fin_payments p on p.contact_id = c.id and p.direction = 'out' and p.voided_at is null
         and p.payment_date >= ${`${year}-01-01`}::date and p.payment_date <= ${`${year}-12-31`}::date
    where c.is_1099 = true
    group by c.id
    order by c.display_name
  `);
  const all = res.rows.map<Vendor1099Row>((r) => {
    const totalCents = Number(r.reportable);
    return {
      contactId: r.id,
      name: r.name,
      kind: r.kind,
      taxIdType: r.tax_id_type,
      taxIdLast4: r.tax_id_last4,
      hasTaxId: r.has_tax_id,
      w9ReceivedOn: r.w9,
      totalCents,
      excludedCents: Number(r.excluded),
      paymentCount: Number(r.n),
      flagged: totalCents >= FORM_1099_THRESHOLD_CENTS,
    };
  });
  const rows = all.filter((r) => r.paymentCount > 0);
  const [{ minYear }] = (
    await db.execute<{ minYear: number | null }>(sql`select extract(year from min(payment_date))::int as "minYear" from fin_payments where direction = 'out'`)
  ).rows;
  const years: number[] = [];
  for (let y = thisYear; y >= Math.min(minYear ?? thisYear, thisYear); y--) years.push(y);
  return {
    year,
    years,
    thresholdCents: FORM_1099_THRESHOLD_CENTS,
    rows,
    flaggedCount: rows.filter((r) => r.flagged).length,
    missingW9Count: rows.filter((r) => r.flagged && !r.w9ReceivedOn).length,
    quietVendors: all.length - rows.length,
  };
}

function formatTin(tin: string, type: string | null): string {
  return type === "ein" ? `${tin.slice(0, 2)}-${tin.slice(2)}` : `${tin.slice(0, 3)}-${tin.slice(3, 5)}-${tin.slice(5)}`;
}

/**
 * CSV for the accountant. The full tax id appears only for finance admins, and each one
 * revealed is audited (`finance.tax_id_viewed`) through revealTaxId.
 */
export async function export1099Csv(ctx: SessionContext, opts: { year?: number } = {}): Promise<{ csv: string; filename: string; revealed: number }> {
  const access = await requireFinance(ctx, "view_all");
  const admin = isFinanceAdmin(access);
  const r = await get1099Report(ctx, opts);
  let revealed = 0;
  const body: (string | number | null)[][] = [];
  for (const row of r.rows) {
    let tin: string | null = null;
    if (admin && row.hasTaxId) {
      try {
        tin = await revealTaxId(ctx, row.contactId);
        if (tin) revealed++;
      } catch (e) {
        if (!(e instanceof DalError)) throw e;
      }
    }
    body.push([
      row.name,
      row.kind === "individual" ? "Individual" : "Organization",
      row.taxIdType ? row.taxIdType.toUpperCase() : "",
      tin ? formatTin(tin, row.taxIdType) : "",
      row.taxIdLast4 ?? "",
      row.w9ReceivedOn ? formatDob(row.w9ReceivedOn) : "No",
      (row.totalCents / 100).toFixed(2),
      row.flagged ? "Yes" : "No",
      (row.excludedCents / 100).toFixed(2),
      row.paymentCount,
    ]);
  }
  const csv = toCsv(
    ["Vendor", "Type", "Tax ID type", "Tax ID", "Last 4", "W-9 received", `Paid in ${r.year} (reportable)`, "Over $600", "Paid by card or Stripe (not reportable)", "Payments"],
    body
  );
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.report_exported",
    targetType: "fin_report",
    targetId: "1099",
    metadata: { report: "1099", period: String(r.year), rowCount: r.rows.length, format: "csv", fullTaxIdsIncluded: revealed },
  });
  return { csv, filename: `finance-1099-${r.year}.csv`, revealed };
}
