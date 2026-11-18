import { z } from "zod";

// Client-safe: used by actions and the DAL.

const uuid = z.string().uuid("Invalid identifier.");
const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

export const MAX_SIGNUP_NOTE = 500;

export const signUpSchema = z
  .object({
    roleId: uuid,
    seasonId: z.preprocess(emptyToNull, uuid.nullable()),
    year: z.preprocess(emptyToNull, z.number().int().min(2000).max(2100).nullable()),
    note: z.preprocess(
      emptyToNull,
      z.string().trim().max(MAX_SIGNUP_NOTE, `Note must be ${MAX_SIGNUP_NOTE} characters or fewer.`).nullable()
    ),
  })
  .refine((v) => (v.seasonId === null) !== (v.year === null), "Choose a term to sign up for.");
export type SignUpInput = z.input<typeof signUpSchema>;

export const assignmentIdSchema = uuid;

/** Value of the term <select>: "season:<uuid>" or "year:<yyyy>". */
export function parseTermValue(v: string): { seasonId: string | null; year: number | null } {
  if (v.startsWith("season:")) return { seasonId: v.slice(7), year: null };
  if (v.startsWith("year:")) {
    const y = Number(v.slice(5));
    return { seasonId: null, year: Number.isInteger(y) ? y : null };
  }
  return { seasonId: null, year: null };
}
