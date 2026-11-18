import { z } from "zod";
import { VOLUNTEER_CATEGORIES } from "@/lib/volunteer-categories";
import { VOLUNTEER_ROLE_PERIODS } from "@/lib/volunteer-roles";
import { PROGRAM_ROLES, PROGRAM_ROLE_LABELS } from "@/lib/validation/programs";

// Client-safe: no server-only imports (used by forms, actions and the DAL).

const uuid = z.string().uuid("Invalid identifier.");

/** "" / null / undefined -> null, otherwise trimmed string. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .nullish()
    .transform((v) => (v ? v : null));

export const GRANTABLE_ROLE_LABELS = PROGRAM_ROLE_LABELS;

/** Decimal hours ("12", "12.5") -> integer minutes, 0-2000 hours. */
const expectedHoursField = z
  .union([z.string(), z.number()])
  .transform((v) => String(v ?? "").trim())
  .refine((v) => v !== "", "Enter the expected hours per term (0 if none).")
  .refine((v) => /^\d{1,4}(\.\d{1,2})?$/.test(v), "Expected hours must be a number like 40 or 12.5.")
  .refine((v) => Number(v) <= 2000, "Expected hours can't be more than 2,000 per term.")
  .transform((v) => Math.round(Number(v) * 60));

const slotsField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v == null ? "" : String(v).trim()))
  .refine((v) => v === "" || /^\d{1,5}$/.test(v), "Slots must be a whole number, or leave it blank for unlimited.")
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || v >= 1, "Slots must be at least 1, or leave it blank for unlimited.");

export const roleInputSchema = z
  .object({
    programId: z
      .string()
      .nullish()
      .transform((v) => (v == null || v.trim() === "" ? null : v.trim()))
      .pipe(z.union([z.null(), uuid])),
    name: z.string().trim().min(2, "Role name must be at least 2 characters.").max(80, "Role name is too long (max 80 characters)."),
    description: optionalText(2000, "Description"),
    category: z.enum(VOLUNTEER_CATEGORIES, { message: "Choose a category." }),
    period: z.enum(VOLUNTEER_ROLE_PERIODS, { message: "Choose per season or per year." }),
    expectedHours: expectedHoursField,
    slots: slotsField,
    requiresApproval: z.boolean().default(true),
    grantsProgramRole: z
      .string()
      .nullish()
      .transform((v) => (v == null || v.trim() === "" ? null : v.trim()))
      .pipe(z.union([z.null(), z.enum(PROGRAM_ROLES, { message: "Choose a valid permission role." })])),
    requiredCredentialIds: z
      .array(uuid)
      .max(50, "Too many required credentials.")
      .default([])
      .transform((ids) => [...new Set(ids)]),
  })
  .superRefine((v, ctx) => {
    if (v.period === "per_season" && !v.programId) {
      ctx.addIssue({ code: "custom", path: ["period"], message: "Per-season roles must belong to a program. Choose per year for an org-wide role." });
    }
    if (v.grantsProgramRole && !v.programId) {
      ctx.addIssue({
        code: "custom",
        path: ["grantsProgramRole"],
        message: "Only program roles can grant permissions. Org-wide roles can't give roster or medical access.",
      });
    }
  })
  // Safety: a role that grants permissions always requires approval, whatever was submitted.
  .transform(({ expectedHours, ...rest }) => ({
    ...rest,
    expectedMinutes: expectedHours,
    requiresApproval: rest.grantsProgramRole ? true : rest.requiresApproval,
  }));

export type RoleInput = z.input<typeof roleInputSchema>;
export type RoleData = z.output<typeof roleInputSchema>;

export const reasonSchema = z
  .string()
  .trim()
  .min(3, "Please give a short reason.")
  .max(500, "Reason is too long (max 500 characters).");

export const noteSchema = z
  .string()
  .trim()
  .max(500, "Note is too long (max 500 characters).")
  .nullish()
  .transform((v) => (v ? v : null));

export const assignInputSchema = z
  .object({
    roleId: uuid,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Enter the volunteer's email.")
      .max(254, "Email is too long.")
      .email("Enter a valid email address."),
    seasonId: z
      .string()
      .nullish()
      .transform((v) => (v == null || v.trim() === "" ? null : v.trim()))
      .pipe(z.union([z.null(), uuid])),
    year: z
      .union([z.string(), z.number(), z.null()])
      .optional()
      .transform((v) => (v == null || String(v).trim() === "" ? null : Number(String(v).trim())))
      .refine((v) => v === null || (Number.isInteger(v) && v >= 2000 && v <= 2100), "Enter a valid year."),
    note: noteSchema,
  })
  .superRefine((v, ctx) => {
    if (v.seasonId && v.year) ctx.addIssue({ code: "custom", message: "Choose a season or a year, not both." });
  });

export type AssignInput = z.input<typeof assignInputSchema>;
export type AssignData = z.output<typeof assignInputSchema>;

const fdStr = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Reads the role form's FormData into the DAL input shape (zod runs in the DAL). */
export function roleInputFromForm(fd: FormData): RoleInput {
  return {
    programId: fdStr(fd, "programId"),
    name: fdStr(fd, "name"),
    description: fdStr(fd, "description"),
    category: fdStr(fd, "category") as RoleInput["category"],
    period: fdStr(fd, "period") as RoleInput["period"],
    expectedHours: fdStr(fd, "expectedHours"),
    slots: fdStr(fd, "slots"),
    requiresApproval: fd.get("requiresApproval") === "on",
    grantsProgramRole: fdStr(fd, "grantsProgramRole"),
    requiredCredentialIds: fd.getAll("requiredCredentialId").map(String),
  };
}

export function assignInputFromForm(fd: FormData): AssignInput {
  return {
    roleId: fdStr(fd, "roleId"),
    email: fdStr(fd, "email"),
    seasonId: fdStr(fd, "seasonId"),
    year: fdStr(fd, "year"),
    note: fdStr(fd, "note"),
  };
}
