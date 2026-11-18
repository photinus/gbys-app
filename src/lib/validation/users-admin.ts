import { z } from "zod";
import { normalizePhone } from "@/lib/validation/household";

// Client-safe: no server-only imports (used by forms, actions and the DAL).

export const ORG_ROLES = ["super_admin", "board_member", "member"] as const;
export type OrgRoleValue = (typeof ORG_ROLES)[number];

export const ORG_ROLE_LABELS: Record<OrgRoleValue, string> = {
  super_admin: "Super admin",
  board_member: "Board member",
  member: "Member",
};

export const USER_PAGE_SIZE = 50;

const uuidLike = z.string().trim().min(1, "Invalid user.").max(64, "Invalid user.");
export const userIdSchema = uuidLike;

export const orgRoleSchema = z.enum(ORG_ROLES, { error: "Choose a valid role." });

const PHONE_MSG = "Enter a valid phone number, e.g. (541) 555-0123.";

export const profileAdminSchema = z.object({
  name: z
    .string({ error: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(100, "Name must be 100 characters or fewer."),
  phone: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((s, ctx): string | null => {
      if (!s) return null;
      const n = normalizePhone(s);
      if (!n) {
        ctx.addIssue({ code: "custom", message: PHONE_MSG });
        return z.NEVER;
      }
      return n;
    }),
});
export type ProfileAdminInput = z.input<typeof profileAdminSchema>;

export const deactivateReasonSchema = z
  .string({ error: "A reason is required." })
  .trim()
  .min(3, "Give a short reason (at least 3 characters).")
  .max(500, "Reason must be 500 characters or fewer.");

export const listUsersSchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((s) => (s ? s : undefined)),
  role: z.enum(["all", ...ORG_ROLES]).default("all"),
  status: z.enum(["active", "deactivated", "all"]).default("active"),
  /** Only users whose email bounced (linked from the admin overview). */
  bounced: z.boolean().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type ListUsersInput = z.input<typeof listUsersSchema>;
