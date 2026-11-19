import { z } from "zod";
import { isIsoDate } from "@/lib/finance/dates";

// Client-safe: used by the budget forms and the DAL.

const uuid = z.string().uuid("Pick a valid option.");

const isoDate = z
  .string()
  .trim()
  .refine((v) => isIsoDate(v), "Enter a valid date.");

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const reason = z.string().trim().min(3, "Please give a short reason.").max(500, "Reason is too long (max 500 characters).");

const name = z.string().trim().min(2, "Give the budget a name (at least 2 characters).").max(120, "Name is too long (max 120 characters).");

export const BUDGET_SOURCES = ["blank", "copy", "actuals"] as const;

export const createBudgetSchema = z
  .object({
    name,
    /** Any date inside the fiscal year to budget; the DAL snaps it to that fiscal year's bounds. */
    fiscalYearDate: isoDate,
    source: z.enum(BUDGET_SOURCES, { message: "Pick how to start the budget." }),
    copyFromBudgetId: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || z.string().uuid().safeParse(v).success, "Pick a budget to copy."),
    notes: optionalText(1000, "Notes"),
  })
  .refine((v) => v.source !== "copy" || v.copyFromBudgetId !== null, { message: "Pick a budget to copy.", path: ["copyFromBudgetId"] });
export type CreateBudgetInput = z.input<typeof createBudgetSchema>;

const monthCents = z.number().int("Amounts must be whole cents.").min(0, "Budget amounts can't be negative.").max(1_000_000_000, "Amount is too large.");

export const budgetLineSchema = z.object({
  accountId: uuid,
  programId: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().uuid().safeParse(v).success, "Pick a valid program."),
  monthlyCents: z.array(monthCents).length(12, "Each line needs 12 monthly amounts."),
  note: optionalText(300, "Line note"),
});
export type BudgetLineInput = z.input<typeof budgetLineSchema>;

export const saveBudgetSchema = z.object({
  id: uuid,
  name,
  notes: optionalText(1000, "Notes"),
  lines: z.array(budgetLineSchema).max(500, "Too many budget lines (500 max)."),
});
export type SaveBudgetInput = z.input<typeof saveBudgetSchema>;

export const unadoptSchema = z.object({ id: uuid, reason });

export const BUDGET_PERIODS = ["month", "ytd", "year"] as const;
