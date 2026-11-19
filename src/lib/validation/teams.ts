import { z } from "zod";

// Client-safe: no server-only imports (used by forms and the DAL).

export const TEAM_STAFF_ROLES = ["head_coach", "assistant_coach", "team_manager"] as const;
export type TeamStaffRoleValue = (typeof TEAM_STAFF_ROLES)[number];

export const TEAM_STAFF_ROLE_LABELS: Record<TeamStaffRoleValue, string> = {
  head_coach: "Head coach",
  assistant_coach: "Assistant coach",
  team_manager: "Team manager",
};

export const TEAM_COLOR_PRESETS = [
  "#2563EB",
  "#DC2626",
  "#16A34A",
  "#F59E0B",
  "#7C3AED",
  "#0891B2",
  "#DB2777",
  "#1C1C1E",
] as const;

const uuid = z.string().uuid("Invalid identifier.");

export const teamInputSchema = z.object({
  name: z.string().trim().min(1, "Team name is required.").max(80, "Team name is too long (max 80 characters)."),
  division: z
    .string()
    .trim()
    .max(80, "Division is too long (max 80 characters).")
    .optional()
    .transform((v) => (v ? v : null)),
  color: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^#[0-9A-Fa-f]{6}$/.test(v), "Color must look like #RRGGBB."),
});
export type TeamInput = z.input<typeof teamInputSchema>;

export const updateTeamSchema = teamInputSchema.extend({ isActive: z.boolean() });
export type UpdateTeamInput = z.input<typeof updateTeamSchema>;

export const registrationIdsSchema = z
  .array(uuid)
  .min(1, "Select at least one player.")
  .max(200, "Select at most 200 players at a time.")
  .transform((ids) => [...new Set(ids)]);

export const jerseySchema = z
  .string()
  .trim()
  .max(3, "Jersey numbers are at most 3 characters.")
  .regex(/^[0-9A-Za-z]*$/, "Use letters and numbers only.")
  .transform((v) => (v ? v : null));

export const teamStaffInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  role: z.enum(TEAM_STAFF_ROLES, { message: "Choose a role." }),
});
export type TeamStaffInput = z.input<typeof teamStaffInputSchema>;

export const idSchema = uuid;
