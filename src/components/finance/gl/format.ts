import { formatCents, formatDob } from "@/lib/format";

/** "2026-11-01" -> "Nov 1, 2026" (accounting dates are LA calendar days; no timezone shift). */
export const fmtDay = (iso: string | null | undefined): string => (iso ? formatDob(iso) : "");

export const money = formatCents;

/** Parse a dollars string ("1,250.50", "-20") to integer cents; null when invalid; "" -> 0. */
export function parseMoney(raw: string, allowNegative = false): number | null {
  const s = raw.trim().replace(/^(-?)\$/, "$1").replace(/,/g, "");
  if (s === "") return 0;
  const re = allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/;
  if (!re.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
