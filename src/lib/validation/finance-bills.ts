import { z } from "zod";
import { isIsoDate } from "@/lib/finance/dates";

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const uuidOrNull = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v), "Invalid selection.");

const isoDate = (msg = "Enter a valid date.") => z.string().refine(isIsoDate, msg);

const cents = (what: string) =>
  z
    .number({ error: `Enter a ${what}.` })
    .int("Amounts must be whole cents.")
    .positive(`Each ${what} must be more than $0.`)
    .max(1_000_000_000, "Amount is too large.");

export const billLineSchema = z.object({
  accountId: z.string().uuid("Choose a category for every line."),
  fundId: uuidOrNull,
  programId: uuidOrNull,
  amountCents: cents("line amount"),
  description: optText(500),
});
export type BillLineInput = z.input<typeof billLineSchema>;

export const newVendorSchema = z.object({
  displayName: z.string().trim().min(1, "Enter the vendor's name.").max(200),
  email: optText(254),
  phone: optText(40),
  kind: z.enum(["individual", "organization"]).default("organization"),
});

export const billInputSchema = z
  .object({
    contactId: uuidOrNull,
    newVendor: newVendorSchema.nullish(),
    vendorInvoiceNumber: optText(100),
    programId: uuidOrNull,
    billDate: isoDate("Enter the bill date."),
    dueDate: z
      .string()
      .nullish()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || isIsoDate(v), "Enter a valid due date."),
    memo: z.string().trim().min(1, "Say what this bill is for.").max(500),
    lines: z.array(billLineSchema).min(1, "Add at least one line.").max(100, "Too many lines."),
  })
  .refine((v) => v.contactId || v.newVendor, { message: "Choose a vendor.", path: ["contactId"] })
  .refine((v) => v.dueDate === null || v.dueDate >= v.billDate, {
    message: "The due date can't be before the bill date.",
    path: ["dueDate"],
  });
export type BillInput = z.input<typeof billInputSchema>;
export type BillInputParsed = z.output<typeof billInputSchema>;

/** Re-categorizing a pending bill: same lines, same amounts, new account/fund/program/note. */
export const recategorizeSchema = z.object({
  lines: z.array(billLineSchema).min(1).max(100),
});

export const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    note: optText(1000),
  })
  .refine((v) => v.decision === "approve" || (v.note && v.note.length >= 3), {
    message: "Tell the submitter why you're sending this back.",
    path: ["note"],
  });
export type DecisionInput = z.input<typeof decisionSchema>;

export const voidReasonSchema = z.string().trim().min(3, "Give a short reason.").max(500);

export const PAYMENT_METHODS = ["check", "ach", "card", "cash", "stripe", "other"] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  check: "Check",
  ach: "Bank transfer (ACH)",
  card: "Card",
  cash: "Cash",
  stripe: "Stripe",
  other: "Other",
};
/** Methods offered when paying a bill (Stripe payouts are never a bill payment). */
export const BILL_PAYMENT_METHODS = ["check", "ach", "card", "cash", "other"] as const;

export const paymentInputSchema = z.object({
  contactId: z.string().uuid("Choose who you're paying."),
  paymentDate: isoDate("Enter the payment date."),
  method: z.enum(BILL_PAYMENT_METHODS),
  reference: optText(100),
  accountId: z.string().uuid("Choose the account the money comes from."),
  memo: optText(500),
  applications: z
    .array(z.object({ billId: z.string().uuid(), amountCents: cents("payment amount") }))
    .min(1, "Pick at least one bill to pay.")
    .max(100),
  bankTxnId: uuidOrNull,
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const reimbursementInputSchema = z.object({
  claimDate: isoDate("Enter the date you paid."),
  memo: z.string().trim().min(1, "Say what this was for.").max(500),
  programId: uuidOrNull,
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Describe each item.").max(500),
        amountCents: cents("item amount"),
      })
    )
    .min(1, "Add at least one item.")
    .max(50),
});
export type ReimbursementInput = z.input<typeof reimbursementInputSchema>;
