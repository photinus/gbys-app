import { z } from "zod";
import { isIsoDate } from "@/lib/finance/dates";

// Client-safe (no server-only imports): used by the donation forms, actions and DAL.

export const GIFT_KINDS = ["cash", "check", "card", "ach", "stripe", "in_kind", "other"] as const;
export type GiftKind = (typeof GIFT_KINDS)[number];

/** Revenue account subtypes offered first in the gift form; every other revenue account is behind "Other". */
export const GIFT_REVENUE_SUBTYPES = ["contributions", "grants", "fundraising events"] as const;

export const FUND_RELEASE_REASON_MIN = 3;

const uuid = z.string().uuid("Pick a valid option.");

const dateField = z
  .string()
  .trim()
  .refine((v) => isIsoDate(v), "Enter a valid date.");

const optText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .optional()
    .transform((v) => (v ? v : null));

const optUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(uuid.nullable());

const cents = z
  .number({ message: "Enter an amount like 100 or 100.00." })
  .int("Enter an amount like 100 or 100.00.")
  .min(0)
  .max(100_000_000_00, "That amount is too large.");

/** A donor created while recording a gift. */
export const newDonorSchema = z.object({
  displayName: z.string().trim().min(1, "Enter the donor's name.").max(200),
  kind: z.enum(["individual", "organization"]).default("individual"),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .refine((v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
  addressLine1: optText(200, "Address"),
  addressLine2: optText(200, "Address line 2"),
  city: optText(100, "City"),
  state: optText(50, "State"),
  postalCode: optText(20, "ZIP code"),
});
export type NewDonorInput = z.input<typeof newDonorSchema>;

export const giftInputSchema = z
  .object({
    /** "existing" (donorContactId), "new" (newDonor), or "anonymous" (no donor). */
    donorMode: z.enum(["existing", "new", "anonymous"]),
    donorContactId: optUuid,
    newDonor: newDonorSchema.optional(),
    giftDate: dateField,
    amountCents: cents.refine((v) => v > 0, "Enter the amount of the gift."),
    kind: z.enum(GIFT_KINDS, { message: "Pick how the gift was given." }),
    reference: optText(100, "Reference"),
    fundId: uuid,
    /** Null = use the fund's program (or none). */
    programId: optUuid,
    revenueAccountId: optUuid,
    depositAccountId: optUuid,
    inKindDebitAccountId: optUuid,
    inKindDescription: optText(1000, "Description"),
    goodsServicesCents: cents.default(0),
    goodsServicesDescription: optText(500, "Description of goods or services"),
    campaign: optText(100, "Campaign"),
    isAnonymous: z.boolean().default(false),
    note: optText(1000, "Note"),
    bankTxnId: optUuid,
  })
  .superRefine((v, ctx) => {
    if (v.donorMode === "existing" && !v.donorContactId) {
      ctx.addIssue({ code: "custom", path: ["donorContactId"], message: "Pick the donor, or choose a different option." });
    }
    if (v.donorMode === "new" && !v.newDonor) {
      ctx.addIssue({ code: "custom", path: ["newDonor"], message: "Enter the new donor's name." });
    }
    if (v.donorMode === "anonymous" && v.kind === "in_kind") {
      ctx.addIssue({ code: "custom", path: ["donorMode"], message: "An in-kind gift needs a donor so it can be acknowledged." });
    }
    if (v.kind === "in_kind" && !v.inKindDescription) {
      ctx.addIssue({ code: "custom", path: ["inKindDescription"], message: "Describe what was donated." });
    }
    if (v.kind === "in_kind" && v.bankTxnId) {
      ctx.addIssue({ code: "custom", path: ["bankTxnId"], message: "In-kind gifts can't be linked to a bank transaction." });
    }
    if (v.goodsServicesCents > v.amountCents) {
      ctx.addIssue({
        code: "custom",
        path: ["goodsServicesCents"],
        message: "The value of goods or services can't be more than the gift.",
      });
    }
    if (v.goodsServicesCents > 0 && !v.goodsServicesDescription) {
      ctx.addIssue({
        code: "custom",
        path: ["goodsServicesDescription"],
        message: "Describe the goods or services the donor received (e.g. dinner for two).",
      });
    }
  });
export type GiftInput = z.input<typeof giftInputSchema>;
export type GiftData = z.output<typeof giftInputSchema>;

export const voidGiftSchema = z.object({
  giftId: uuid,
  reason: z.string().trim().min(3, "Enter a reason.").max(500),
});

export const releaseFundSchema = z.object({
  fundId: uuid,
  amountCents: cents.refine((v) => v > 0, "Enter the amount to release."),
  date: dateField,
  reason: z
    .string()
    .trim()
    .min(FUND_RELEASE_REASON_MIN, "Say what the money was spent on or why it is being released.")
    .max(300),
});
export type ReleaseFundInput = z.input<typeof releaseFundSchema>;

export const RECEIPT_FILTERS = ["all", "needed", "required", "sent", "not_sent"] as const;
export type ReceiptFilter = (typeof RECEIPT_FILTERS)[number];

export interface GiftFilters {
  from?: string;
  to?: string;
  fundId?: string;
  campaign?: string;
  donorId?: string;
  receipt?: ReceiptFilter;
  includeVoided?: boolean;
  page?: number;
}

export const GIFTS_PAGE_SIZE = 50;

export const rangeSchema = z
  .object({ from: dateField, to: dateField })
  .refine((v) => v.from <= v.to, "The start date must be on or before the end date.");

export const yearSchema = z.number().int().min(2000, "Enter a valid year.").max(2100, "Enter a valid year.");

export function parseDollarsToCents(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
