import { z } from "zod";
import { isIsoDate } from "@/lib/finance/dates";

// Client-safe (no server-only imports): used by the receivables forms and the DAL.

const uuid = z.string().uuid("Pick a valid option.");

const optionalUuid = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().uuid().safeParse(v).success, "Pick a valid option.");

const isoDate = z
  .string()
  .trim()
  .refine((v) => isIsoDate(v), "Enter a valid date.");

const optionalDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isIsoDate(v), "Enter a valid date.");

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const reason = z.string().trim().min(3, "Please give a short reason.").max(500, "Reason is too long (max 500 characters).");

const cents = z
  .number({ message: "Enter an amount." })
  .int("Amounts must be whole cents.")
  .min(1, "Each amount must be more than $0.")
  .max(1_000_000_000, "Amount is too large.");

export const invoiceLineSchema = z.object({
  description: z.string().trim().min(1, "Describe each line (for example “Sponsorship, spring season”).").max(300, "Line description is too long (max 300 characters)."),
  accountId: uuid,
  fundId: optionalUuid,
  programId: optionalUuid,
  amountCents: cents,
});
export type InvoiceLineInput = z.input<typeof invoiceLineSchema>;

export const invoiceInputSchema = z
  .object({
    contactId: uuid,
    issueDate: isoDate,
    dueDate: optionalDate,
    memo: optionalText(1000, "Memo"),
    lines: z.array(invoiceLineSchema).min(1, "Add at least one line.").max(50, "Too many lines (50 max)."),
  })
  .refine((v) => v.dueDate === null || v.dueDate >= v.issueDate, { message: "The due date can't be before the issue date.", path: ["dueDate"] });
export type InvoiceInput = z.input<typeof invoiceInputSchema>;

export const voidReasonSchema = z.object({ id: uuid, reason });

export const sendInvoiceSchema = z.object({
  id: uuid,
  toEmail: z
    .string()
    .trim()
    .max(254)
    .nullable()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
});

export const PAYMENT_METHODS = ["check", "ach", "card", "cash", "stripe", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  check: "Check",
  ach: "Bank transfer (ACH)",
  card: "Card",
  cash: "Cash",
  stripe: "Stripe",
  other: "Other",
};

export const paymentInSchema = z.object({
  contactId: uuid,
  paymentDate: isoDate,
  method: z.enum(PAYMENT_METHODS, { message: "Pick how it was paid." }),
  reference: optionalText(100, "Reference"),
  /** Where the money went: a bank account or Undeposited funds. */
  accountId: uuid,
  memo: optionalText(500, "Memo"),
  applications: z
    .array(z.object({ invoiceId: uuid, amountCents: cents }))
    .min(1, "Choose at least one invoice and an amount.")
    .max(100, "Too many invoices (100 max)."),
  bankTxnId: optionalUuid,
});
export type PaymentInInput = z.input<typeof paymentInSchema>;

export const voidPaymentSchema = z.object({ paymentId: uuid, reason });

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  partially_paid: "Partly paid",
  paid: "Paid",
  void: "Void",
};

export const INVOICE_STATUS_FILTERS = ["draft", "open", "partially_paid", "paid", "void", "unpaid"] as const;
