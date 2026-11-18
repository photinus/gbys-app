// RFC 4180 CSV writer with a spreadsheet formula-injection guard.
// Client-safe and dependency-free.

const BOM = "﻿";
const CRLF = "\r\n";

/**
 * Neutralize cells that a spreadsheet would interpret as a formula: values that
 * start with = + - @ or a tab / carriage return get a leading apostrophe.
 */
export function guardCsvInjection(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Quote a (guarded) cell when it contains a comma, quote, CR or LF. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = guardCsvInjection(String(value));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header + rows -> CSV text: UTF-8 BOM, CRLF line endings (including after the last row). */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return BOM + lines.join(CRLF) + CRLF;
}
