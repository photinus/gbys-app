import { z } from "zod";

// Client-safe: no server-only imports.

export const CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const name = z.string().trim().min(2, "Name must be at least 2 characters.").max(120, "Name is too long (max 120 characters).");
const description = z
  .string()
  .trim()
  .max(1000, "Description is too long (max 1000 characters).")
  .optional()
  .transform((v) => (v ? v : null));
const validity = z.coerce
  .number({ message: "Validity must be a number of months." })
  .int("Validity must be a whole number of months.")
  .min(1, "Validity must be at least 1 month.")
  .max(120, "Validity can be at most 120 months.");

export const credentialIdSchema = z.string().uuid("Invalid identifier.");

export const createCredentialTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code must be at least 2 characters.")
    .max(50, "Code is too long (max 50 characters).")
    .regex(CODE_PATTERN, "Code must be lowercase snake_case (letters, numbers, underscores), e.g. youth_first_aid."),
  name,
  description,
  defaultValidityMonths: validity,
});
export type CreateCredentialTypeInput = z.input<typeof createCredentialTypeSchema>;

export const updateCredentialTypeSchema = z.object({ name, description, defaultValidityMonths: validity });
export type UpdateCredentialTypeInput = z.input<typeof updateCredentialTypeSchema>;
