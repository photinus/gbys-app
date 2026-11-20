/** Pure helpers for payables (Finance 2, PB): bill status from payments, A/P aging buckets, check amount in words. */

import { addDays, type IsoDate } from "./dates";

export type OpenBillStatus = "approved" | "partially_paid" | "paid";

/** Status of an approved bill given what has been paid (cents). */
export function statusFromPaid(totalCents: number, paidCents: number): OpenBillStatus {
  if (paidCents <= 0) return "approved";
  if (paidCents >= totalCents) return "paid";
  return "partially_paid";
}

/** Default due date: bill date + 30 days. */
export function defaultDueDate(billDate: IsoDate): IsoDate {
  return addDays(billDate, 30);
}

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
export const AGING_BUCKETS: readonly AgingBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];
export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "Over 90 days",
};

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Bucket by days past due as of `asOf` (not yet due = current). */
export function agingBucket(dueDate: IsoDate, asOf: IsoDate): AgingBucket {
  const late = daysBetween(dueDate, asOf);
  if (late <= 0) return "current";
  if (late <= 30) return "d1_30";
  if (late <= 60) return "d31_60";
  if (late <= 90) return "d61_90";
  return "d90_plus";
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/** 123456 cents -> "One thousand two hundred thirty-four and 56/100 dollars". */
export function amountInWords(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const frac = Math.abs(cents) % 100;
  let words: string;
  if (whole === 0) words = "zero";
  else {
    const groups: [number, string][] = [
      [Math.floor(whole / 1_000_000_000), "billion"],
      [Math.floor(whole / 1_000_000) % 1000, "million"],
      [Math.floor(whole / 1000) % 1000, "thousand"],
      [whole % 1000, ""],
    ];
    words = groups
      .filter(([n]) => n > 0)
      .map(([n, label]) => `${below1000(n)}${label ? ` ${label}` : ""}`)
      .join(" ");
  }
  const sentence = words.charAt(0).toUpperCase() + words.slice(1);
  return `${sentence} and ${String(frac).padStart(2, "0")}/100 dollars`;
}
