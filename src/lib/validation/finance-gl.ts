import { z } from "zod";
import { isIsoDate } from "@/lib/finance/dates";

// Client-safe (no server-only imports): used by the finance forms and the DAL.

export const ACCOUNT_TYPES = ["asset", "liability", "net_assets", "revenue", "expense"] as const;
export type AccountTypeValue = (typeof ACCOUNT_TYPES)[number];

/** Plain-language names for the five account types (volunteer-friendly). */
export const ACCOUNT_TYPE_LABELS: Record<AccountTypeValue, string> = {
  asset: "Things we own (assets)",
  liability: "Things we owe (liabilities)",
  net_assets: "Net assets (what's left over)",
  revenue: "Money in (revenue)",
  expense: "Money out (expenses)",
};
export const ACCOUNT_TYPE_SHORT: Record<AccountTypeValue, string> = {
  asset: "Asset",
  liability: "Liability",
  net_assets: "Net assets",
  revenue: "Revenue",
  expense: "Expense",
};

export const RESTRICTIONS = ["without_donor_restrictions", "with_donor_restrictions"] as const;
export type RestrictionValue = (typeof RESTRICTIONS)[number];
export const RESTRICTION_LABELS: Record<RestrictionValue, string> = {
  without_donor_restrictions: "Unrestricted",
  with_donor_restrictions: "Donor restricted",
};

export const ENTRY_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual entry",
  opening_balance: "Opening balances",
  bank: "Bank transaction",
  transfer: "Bank transfer",
  registration: "Registration payment",
  stripe_fee: "Stripe fees",
  stripe_payout: "Stripe payout",
  platform_fee: "Partner platform fee",
  bill: "Bill",
  bill_payment: "Bill payment",
  invoice: "Invoice",
  invoice_payment: "Invoice payment",
  donation: "Donation",
  reimbursement: "Reimbursement",
  fund_release: "Fund release",
};

/** Sources the board can edit directly in the journal. */
export const EDITABLE_SOURCES = ["manual", "opening_balance"] as const;

export const JOURNAL_PAGE_SIZE = 50;

const uuid = z.string().uuid("Pick a valid option.");

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || z.string().uuid().safeParse(v).success, "Pick a valid option.");

export const isoDateSchema = z
  .string()
  .trim()
  .refine((v) => isIsoDate(v), "Enter a valid date.");

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || isIsoDate(v), "Enter a valid date.");

// ---- Accounts & funds ------------------------------------------------------

export const accountCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9.\-]{3,10}$/, "Account number must be 3 to 10 characters: digits, dots or dashes (e.g. 6025).");

export const accountSchema = z.object({
  code: accountCodeSchema,
  name: z.string().trim().min(2, "Account name must be at least 2 characters.").max(80, "Account name is too long (max 80 characters)."),
  type: z.enum(ACCOUNT_TYPES, { message: "Pick an account type." }),
  subtype: optionalText(60, "Group"),
  description: optionalText(300, "Description"),
  isBank: z.boolean().default(false),
  is1099: z.boolean().default(false),
});
export type AccountInput = z.input<typeof accountSchema>;

export const updateAccountSchema = accountSchema.extend({ id: uuid });

export const fundSchema = z.object({
  name: z.string().trim().min(2, "Fund name must be at least 2 characters.").max(80, "Fund name is too long (max 80 characters)."),
  code: optionalText(12, "Fund code"),
  restriction: z.enum(RESTRICTIONS, { message: "Pick whether the fund is restricted." }),
  programId: optionalUuid,
  purpose: optionalText(300, "Purpose"),
});
export type FundInput = z.input<typeof fundSchema>;
export const updateFundSchema = fundSchema.extend({ id: uuid });

export const setActiveSchema = z.object({ id: uuid, isActive: z.boolean() });

// ---- Journal ---------------------------------------------------------------

export const entryLineSchema = z.object({
  accountId: uuid,
  fundId: optionalUuid,
  programId: optionalUuid,
  debitCents: z.number().int("Amounts must be whole cents.").min(0).max(1_000_000_000),
  creditCents: z.number().int("Amounts must be whole cents.").min(0).max(1_000_000_000),
  description: optionalText(500, "Line note"),
});
export type EntryLineInput = z.input<typeof entryLineSchema>;

const memoSchema = z.string().trim().min(2, "Describe the entry in a few words.").max(500, "Memo is too long (max 500 characters).");
const reasonSchema = z.string().trim().min(3, "Please give a short reason.").max(500, "Reason is too long (max 500 characters).");

export const manualEntrySchema = z.object({
  entryDate: isoDateSchema,
  memo: memoSchema,
  lines: z.array(entryLineSchema).min(2, "Add at least two lines.").max(200, "Too many lines (200 max)."),
});
export type ManualEntryInput = z.input<typeof manualEntrySchema>;

export const replaceEntrySchema = manualEntrySchema.extend({ entryId: uuid, reason: reasonSchema });
export const voidEntrySchema = z.object({ entryId: uuid, reason: reasonSchema });

export const openingBalancesSchema = z.object({
  asOfDate: isoDateSchema,
  memo: z.string().trim().max(500).optional().default("Opening balances"),
  rows: z
    .array(
      z.object({
        accountId: uuid,
        fundId: optionalUuid,
        /** Natural balance in cents (negative = the opposite side, e.g. accumulated depreciation). */
        amountCents: z.number().int("Amounts must be whole cents.").min(-1_000_000_000).max(1_000_000_000),
      })
    )
    .min(1, "Enter at least one balance.")
    .max(100),
});
export type OpeningBalancesInput = z.input<typeof openingBalancesSchema>;

export const listEntriesSchema = z.object({
  from: optionalDate,
  to: optionalDate,
  source: z.string().trim().optional().nullable(),
  accountId: optionalUuid,
  q: z.string().trim().max(100).optional().nullable(),
  cursor: z.number().int().positive().optional().nullable(),
});
export type ListEntriesInput = z.input<typeof listEntriesSchema>;

// ---- Settings, close, access ----------------------------------------------

export const settingsSchema = z.object({
  fiscalYearStartMonth: z.number().int().min(1, "Pick a month.").max(12, "Pick a month."),
  stripePayoutAccountId: optionalUuid,
  autoPostStartDate: optionalDate,
  /** Dollars string, blank = none. Parsed to cents in the DAL. */
  dualApprovalThresholdDollars: z
    .string()
    .trim()
    .max(12)
    .transform((v) => v.replace(/^\$/, "").replace(/,/g, ""))
    .refine((v) => v === "" || /^\d{1,8}(\.\d{1,2})?$/.test(v), "Enter a dollar amount like 500 or 500.00, or leave it blank.")
    .transform((v) => (v === "" ? null : Math.round(Number(v) * 100))),
});
export type SettingsInput = z.input<typeof settingsSchema>;

export const closeBooksSchema = z.object({
  lockDate: isoDateSchema,
  note: optionalText(300, "Note"),
});
export const reopenBooksSchema = z.object({
  /** New lock date (earlier than the current one), or null to reopen everything. */
  lockDate: optionalDate,
  reason: reasonSchema,
});

export const FINANCE_GRANT_ROLES = ["admin", "editor", "viewer"] as const;
export const grantAccessSchema = z
  .object({
    userId: z.string().trim().min(1, "Pick a person first."),
    role: z.enum(FINANCE_GRANT_ROLES, { message: "Pick a role." }),
    programId: optionalUuid,
  })
  .refine((v) => !(v.programId && v.role === "admin"), {
    message: "Program access can be editor or viewer only. Admin applies to the whole organization.",
    path: ["role"],
  });
export type GrantAccessInput = z.input<typeof grantAccessSchema>;
export const revokeAccessSchema = z.object({ grantId: uuid });

export const FINANCE_ROLE_LABELS: Record<(typeof FINANCE_GRANT_ROLES)[number], string> = {
  admin: "Finance admin",
  editor: "Bookkeeper (editor)",
  viewer: "Viewer",
};
export const FINANCE_ROLE_HELP: Record<(typeof FINANCE_GRANT_ROLES)[number], string> = {
  admin: "Everything, including settings, closing the books and who has access.",
  editor: "Can enter and fix transactions, manage accounts and funds, and use the bank inbox.",
  viewer: "Can look at everything but can't change anything.",
};

/** Sum debits/credits of editor lines (cents). */
export function lineTotals(lines: { debitCents: number; creditCents: number }[]) {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += l.debitCents || 0;
    credit += l.creditCents || 0;
  }
  return { debit, credit, diff: debit - credit };
}
