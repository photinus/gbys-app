import { z } from "zod";

// Client-safe validation for the public registration + e-signature flow.

export const SIGNATURE_MAX = 120;

/** Collapses internal whitespace so "  Jane   Q  Doe " is stored as "Jane Q Doe". */
export function normalizeSignatureName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Typed legal name: at least two words, at most 120 characters. */
export const signatureNameSchema = z
  .string({ error: "Type your full legal name to sign." })
  .transform(normalizeSignatureName)
  .pipe(
    z
      .string()
      .max(SIGNATURE_MAX, `Your name can be at most ${SIGNATURE_MAX} characters.`)
      .refine((s) => s.split(" ").filter(Boolean).length >= 2, "Type your full legal name (first and last)."),
  );

export const registrationSubmitSchema = z.object({
  seasonId: z.string().uuid("Choose a season."),
  athleteId: z.string().uuid("Choose an athlete."),
  answers: z.record(z.string(), z.unknown()).default({}),
  waiverVersionId: z.string().uuid("The waiver is missing. Reload the page."),
  signatureName: signatureNameSchema,
  agree: z.literal(true, { error: "You must agree to the waiver to register." }),
});

export type RegistrationSubmitInput = z.infer<typeof registrationSubmitSchema>;

export const withdrawSchema = z.object({ registrationId: z.string().uuid() });
