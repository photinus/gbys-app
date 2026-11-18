import { z } from "zod";

// Client-safe: no server-only imports (used by both forms and the DAL).

export const PROGRAM_ROLES = [
  "program_admin",
  "head_coach",
  "assistant_coach",
  "team_manager",
  "volunteer",
] as const;
export type ProgramRoleValue = (typeof PROGRAM_ROLES)[number];

export const PROGRAM_ROLE_LABELS: Record<ProgramRoleValue, string> = {
  program_admin: "Program admin",
  head_coach: "Head coach",
  assistant_coach: "Assistant coach",
  team_manager: "Team manager",
  volunteer: "Volunteer",
};

const uuid = z.string().uuid("Invalid identifier.");

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .min(2, "Slug must be at least 2 characters.")
  .max(60, "Slug is too long (max 60 characters).")
  .regex(SLUG_PATTERN, "Slug must be lowercase letters, numbers and single hyphens (e.g. youth-wrestling).");

const programFields = {
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long (max 120 characters)."),
  slug: slugSchema,
  sport: z.string().trim().min(1, "Sport is required.").max(60, "Sport is too long (max 60 characters)."),
  description: z
    .string()
    .trim()
    .max(2000, "Description is too long (max 2000 characters).")
    .optional()
    .transform((v) => (v ? v : null)),
  isIndependentPartner: z.boolean().default(false),
  requiredCredentialIds: z
    .array(uuid)
    .max(50, "Too many required credentials.")
    .default([])
    .transform((ids) => [...new Set(ids)]),
};

export const createProgramSchema = z.object(programFields);
export type CreateProgramInput = z.input<typeof createProgramSchema>;

export const updateProgramSchema = z.object({
  ...programFields,
  isActive: z.boolean(),
});
export type UpdateProgramInput = z.input<typeof updateProgramSchema>;

export const grantRoleSchema = z.object({
  programId: uuid,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required.")
    .max(254, "Email is too long.")
    .email("Enter a valid email address."),
  role: z.enum(PROGRAM_ROLES, { error: "Choose a role." }),
});
export type GrantRoleInput = z.input<typeof grantRoleSchema>;

export const programIdSchema = uuid;
