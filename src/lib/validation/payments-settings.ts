import { z } from "zod";

// Client-safe: no server-only imports (used by forms, actions and the DAL).

/** Flat platform fee ceiling per registration ($100). */
export const MAX_PLATFORM_FEE_FLAT_CENTS = 10_000;
/** Percent ceiling in basis points (30%); mirrors the DB check constraint. */
export const MAX_PLATFORM_FEE_BPS = 3000;

export const platformFeeSchema = z.object({
  flatCents: z
    .number({ message: "Enter the flat fee in dollars." })
    .int("The flat fee must be a whole number of cents.")
    .min(0, "The flat fee cannot be negative.")
    .max(MAX_PLATFORM_FEE_FLAT_CENTS, "The flat fee cannot exceed $100.00."),
  bps: z
    .number({ message: "Enter the percentage." })
    .int("The percentage can have at most two decimal places.")
    .min(0, "The percentage cannot be negative.")
    .max(MAX_PLATFORM_FEE_BPS, "The percentage cannot exceed 30%."),
});
export type PlatformFeeInput = z.infer<typeof platformFeeSchema>;

/** "12.50" / "$12.5" / "" (= 0) -> cents. Returns NaN when unparseable. */
export function parseDollarsToCents(raw: string): number {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** "2.9" / "2.9%" / "" (= 0) -> basis points (max two decimals). NaN when unparseable. */
export function parsePercentToBps(raw: string): number {
  const s = raw.trim().replace(/%$/, "").trim();
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** 290 -> "2.9%", 0 -> "0%". */
export function formatBpsAsPercent(bps: number): string {
  const s = (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${s === "" ? "0" : s}%`;
}
