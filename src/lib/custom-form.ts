import { z } from "zod";
import type { CustomFormField } from "@/db/schema/programs";

// Client-safe helpers for seasons.customFormSchema (form builder + registration).
export type { CustomFormField };

export const CUSTOM_FIELD_TYPES = ["text", "textarea", "select", "checkbox", "number"] as const;
export const CUSTOM_FIELD_TYPE_LABELS: Record<(typeof CUSTOM_FIELD_TYPES)[number], string> = {
  text: "Short text",
  textarea: "Long text",
  select: "Dropdown",
  checkbox: "Checkbox",
  number: "Number",
};

const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Field keys use lowercase letters, numbers and underscores.");

export const customFormFieldSchema = z
  .object({
    key: keySchema,
    label: z.string().trim().min(1, "Every field needs a label.").max(120),
    type: z.enum(CUSTOM_FIELD_TYPES),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    placeholder: z.string().trim().max(120).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === "select" && (!f.options || f.options.length < 2)) {
      ctx.addIssue({ code: "custom", message: `"${f.label}" needs at least two options.` });
    }
  });

/** Validates a whole form definition (max 25 fields, unique keys). */
export const customFormSchemaSchema = z
  .array(customFormFieldSchema)
  .max(25, "A season form can have at most 25 fields.")
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.key)) ctx.addIssue({ code: "custom", message: `Duplicate field key "${f.key}".` });
      seen.add(f.key);
    }
  });

/**
 * Builds a zod schema for registration answers from a season's field list.
 * Unknown keys are stripped; checkbox -> boolean, number -> number, others -> string.
 * Required checkboxes must be checked.
 */
export function buildAnswersSchema(fields: CustomFormField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case "checkbox":
        s = f.required
          ? z.literal(true, { message: `"${f.label}" must be checked.` })
          : z.boolean().optional().default(false);
        break;
      case "number": {
        // Blank -> undefined (never coerced to 0), then a finite number.
        const n = z.preprocess(
          (v) => (v === "" || v === null || v === undefined ? undefined : typeof v === "string" ? Number(v) : v),
          f.required
            ? z.number({ message: `"${f.label}" must be a number.` }).finite()
            : z.number({ message: `"${f.label}" must be a number.` }).finite().optional()
        );
        s = n;
        break;
      }
      case "select": {
        const opts = (f.options ?? []) as [string, ...string[]];
        const e = z.enum(opts, { message: `Choose an option for "${f.label}".` });
        s = f.required ? e : z.union([z.literal("").transform(() => undefined), e]).optional();
        break;
      }
      default: {
        const t = z.string().trim().max(f.type === "textarea" ? 2000 : 200);
        s = f.required ? t.min(1, `"${f.label}" is required.`) : t.optional();
      }
    }
    shape[f.key] = s;
  }
  return z.object(shape).strip();
}

/** Sample field sets for the builder's "Start from a template" menu. */
export const CUSTOM_FORM_TEMPLATES: { id: string; name: string; fields: CustomFormField[] }[] = [
  {
    id: "cal_ripken",
    name: "Cal Ripken Baseball",
    fields: [
      { key: "jersey_size", label: "Jersey size", type: "select", required: true, options: ["Youth S", "Youth M", "Youth L", "Youth XL", "Adult S", "Adult M"] },
      { key: "division", label: "League age / division", type: "select", required: true, options: ["T-Ball (4-6U)", "Rookie (7-8U)", "Minors (9-10U)", "Majors (11-12U)"] },
      { key: "prior_experience", label: "Years of prior experience", type: "number", required: false },
      { key: "volunteer_interest", label: "A parent can help coach or volunteer", type: "checkbox", required: false },
    ],
  },
  {
    id: "wrestling",
    name: "Youth Wrestling",
    fields: [
      { key: "weight_lbs", label: "Approximate weight (lbs)", type: "number", required: true },
      { key: "singlet_size", label: "Singlet size", type: "select", required: true, options: ["Youth S", "Youth M", "Youth L", "Adult S", "Adult M"] },
      { key: "usaw_card", label: "USA Wrestling card number (if any)", type: "text", required: false },
    ],
  },
];
