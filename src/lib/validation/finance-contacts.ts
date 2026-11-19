import { z } from "zod";

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const contactInputSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name.").max(200),
  kind: z.enum(["individual", "organization"]).default("organization"),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
  phone: opt(40),
  addressLine1: opt(200),
  addressLine2: opt(200),
  city: opt(100),
  state: opt(50),
  postalCode: opt(20),
  isVendor: z.boolean().default(false),
  isCustomer: z.boolean().default(false),
  isDonor: z.boolean().default(false),
  is1099: z.boolean().default(false),
  defaultAccountId: z.string().uuid().nullable().optional(),
  notes: opt(2000),
});
export type ContactInput = z.input<typeof contactInputSchema>;

/** SSN (9 digits) or EIN (9 digits); dashes/spaces ignored. Empty = leave unchanged. */
export const taxIdInputSchema = z.object({
  taxIdType: z.enum(["ssn", "ein"]),
  taxId: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => /^\d{9}$/.test(v), "A tax ID is 9 digits."),
});
