import { z } from "zod";

export const ROSTER_FILTERS = ["all", "unpaid", "paid", "cancelled"] as const;
export type RosterFilter = (typeof ROSTER_FILTERS)[number];

export function parseRosterFilter(v: unknown): RosterFilter {
  return (ROSTER_FILTERS as readonly string[]).includes(v as string) ? (v as RosterFilter) : "all";
}

export const OFFLINE_METHODS = ["cash", "check", "scholarship"] as const;
export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

export const OFFLINE_METHOD_LABELS: Record<OfflineMethod, string> = {
  cash: "Cash",
  check: "Check",
  scholarship: "Scholarship / waived",
};

export const recordPaymentSchema = z
  .object({
    method: z.enum(OFFLINE_METHODS, { message: "Choose how the family paid." }),
    amountCents: z.number().int("Enter a valid amount.").min(0).max(10_000_000),
    reference: z.string().trim().max(200, "Keep the note under 200 characters.").default(""),
  })
  .superRefine((v, ctx) => {
    if (v.method === "check" && !v.reference) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the check number." });
    }
    if (v.method === "scholarship" && !v.reference) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "A note is required for a scholarship." });
    }
    if (v.method !== "scholarship" && v.amountCents <= 0) {
      ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Amount must be greater than $0." });
    }
  });
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const reasonSchema = z
  .string()
  .trim()
  .min(3, "A reason is required.")
  .max(500, "Keep the reason under 500 characters.");

/** "12.50" / "$12" -> cents, or null when invalid. */
export function dollarsToCents(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
