import type { IsoDate } from "@/lib/finance/dates";

/**
 * Receivables aging buckets (pure, client-safe). Days past due = asOf - dueDate; an invoice
 * with no due date is due on its issue date.
 */

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d1_30: "1-30 days",
  d31_60: "31-60 days",
  d61_90: "61-90 days",
  d90_plus: "Over 90 days",
};

/** Whole days from `a` to `b` (b - a) between two "YYYY-MM-DD" dates. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export function daysPastDue(dueDate: IsoDate | null, issueDate: IsoDate, asOf: IsoDate): number {
  return daysBetween(dueDate ?? issueDate, asOf);
}

export function agingBucketOf(dueDate: IsoDate | null, issueDate: IsoDate, asOf: IsoDate): AgingBucket {
  const d = daysPastDue(dueDate, issueDate, asOf);
  if (d <= 0) return "current";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90_plus";
}

export type BucketTotals = Record<AgingBucket, number> & { total: number };

export function emptyBuckets(): BucketTotals {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
}

export interface AgingInput {
  invoiceId: string;
  number: number;
  contactId: string;
  contactName: string;
  issueDate: IsoDate;
  dueDate: IsoDate | null;
  /** Outstanding balance as of the report date. */
  balanceCents: number;
}

export interface AgingRow extends AgingInput {
  bucket: AgingBucket;
  daysPastDue: number;
}

export interface AgingGroup {
  contactId: string;
  contactName: string;
  rows: AgingRow[];
  totals: BucketTotals;
}

export interface AgingReport {
  asOf: IsoDate;
  groups: AgingGroup[];
  totals: BucketTotals;
}

/** Group outstanding invoices by customer (alphabetical) with bucket totals; zero balances are dropped. */
export function buildAging(rows: readonly AgingInput[], asOf: IsoDate): AgingReport {
  const groups = new Map<string, AgingGroup>();
  const totals = emptyBuckets();
  for (const r of rows) {
    if (r.balanceCents <= 0) continue;
    const bucket = agingBucketOf(r.dueDate, r.issueDate, asOf);
    let g = groups.get(r.contactId);
    if (!g) groups.set(r.contactId, (g = { contactId: r.contactId, contactName: r.contactName, rows: [], totals: emptyBuckets() }));
    g.rows.push({ ...r, bucket, daysPastDue: daysPastDue(r.dueDate, r.issueDate, asOf) });
    g.totals[bucket] += r.balanceCents;
    g.totals.total += r.balanceCents;
    totals[bucket] += r.balanceCents;
    totals.total += r.balanceCents;
  }
  const list = [...groups.values()].sort((a, b) => a.contactName.localeCompare(b.contactName));
  for (const g of list) g.rows.sort((a, b) => (a.dueDate ?? a.issueDate).localeCompare(b.dueDate ?? b.issueDate) || a.number - b.number);
  return { asOf, groups: list, totals };
}
