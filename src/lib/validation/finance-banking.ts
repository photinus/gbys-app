import { z } from "zod";
import { isIsoDate } from "@/lib/finance/dates";

/** Zod schemas for the banking server actions (workstream FB). Amounts are integer cents. */

const uuid = z.string().uuid("Invalid selection.");
/** "" / undefined / null -> null, otherwise a uuid. */
const optUuid = z.preprocess((v) => (v === "" || v === undefined ? null : v), uuid.nullable());
const optText = (max: number, msg = `Keep this under ${max} characters.`) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v ?? null), z.string().trim().max(max, msg).nullable());
const isoDate = z.string().refine(isIsoDate, "Enter a valid date.");
const cents = z.number().int("Enter a valid amount.");

export const connectSchema = z.object({
  token: z.string().trim().min(10, "Paste the SimpleFIN setup token.").max(4000, "That token is too long."),
  label: z.string().trim().min(1, "Give the connection a name.").max(80, "Keep the name under 80 characters."),
});

export const mappingSchema = z.object({
  bankAccountId: uuid,
  glAccountId: optUuid,
  importStartDate: isoDate,
});

export const categoryLineSchema = z.object({
  accountId: uuid,
  fundId: optUuid,
  programId: optUuid,
  amountCents: cents.min(1, "Each part needs an amount above zero.").max(1_000_000_000),
  memo: optText(500),
});

export const categorizeSchema = z.object({
  txnId: uuid,
  memo: optText(500),
  lines: z.array(categoryLineSchema).min(1, "Choose a category.").max(25, "Too many parts (25 max)."),
});

export const bulkCategorizeSchema = z.object({
  txnIds: z.array(uuid).min(1, "Select at least one transaction.").max(200, "Select 200 or fewer at a time."),
  accountId: uuid,
  fundId: optUuid,
  programId: optUuid,
});

export const transferSchema = z.object({
  txnId: uuid,
  toGlAccountId: uuid,
  memo: optText(500),
});

export const matchSchema = z.object({ txnId: uuid, entryId: uuid });

export const EXCLUDE_REASONS = ["duplicate", "personal", "other"] as const;
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number];
export const EXCLUDE_REASON_LABELS: Record<ExcludeReason, string> = {
  duplicate: "Duplicate",
  personal: "Personal / not GBYS",
  other: "Other",
};
export const excludeSchema = z.object({
  txnId: uuid,
  reason: z.enum(EXCLUDE_REASONS, { message: "Choose a reason." }),
  note: optText(300),
});

export const txnIdSchema = z.object({ txnId: uuid });

export const INBOX_TABS = ["new", "posted", "excluded"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const ruleSchema = z
  .object({
    id: optUuid,
    name: z.string().trim().min(1, "Give the rule a name.").max(100, "Keep the name under 100 characters."),
    priority: z.number().int().min(1).max(100000).default(100),
    matchField: z.enum(["description", "payee"]).default("description"),
    matchType: z.enum(["contains", "equals", "starts_with"]).default("contains"),
    matchText: z.string().trim().min(1, "Enter the text to look for.").max(200, "Keep it under 200 characters."),
    direction: z.enum(["any", "deposit", "withdrawal"]).default("any"),
    minAmountCents: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    maxAmountCents: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    bankAccountId: optUuid,
    accountId: uuid,
    fundId: optUuid,
    programId: optUuid,
    memo: optText(300),
    autoPost: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.minAmountCents !== null && v.maxAmountCents !== null && v.minAmountCents > v.maxAmountCents) {
      ctx.addIssue({ code: "custom", path: ["maxAmountCents"], message: "The maximum can't be below the minimum." });
    }
  });
export type RuleInput = z.infer<typeof ruleSchema>;

export const startReconciliationSchema = z.object({
  glAccountId: uuid,
  statementEndDate: isoDate,
  endingBalanceCents: cents.min(-1_000_000_000_00).max(1_000_000_000_00),
});

export const clearLinesSchema = z.object({
  reconciliationId: uuid,
  lineIds: z.array(uuid).min(1).max(2000),
  cleared: z.boolean(),
});

export const reconciliationIdSchema = z.object({ reconciliationId: uuid });

/** Parse a money input that may be negative ("-1,234.50"). Returns null when invalid. */
export function parseSignedDollars(raw: string): number | null {
  const s = raw.trim().replace(/[$,\s]/g, "");
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const c = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -c : c;
}
