import { z } from "zod";
import { ALLOWED_PROOF_TYPES, MAX_PROOF_BYTES } from "@/lib/storage";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";

// NOTE: imports storage constants; use from server code only (do not import in client components).

const SSN_LIKE = /^\d{3}[-\s]?\d{2}[-\s]?\d{4}$/;

/** Last instant of "today" in America/Los_Angeles. */
function endOfTodayLa(): number {
  return laDateInputToUtc(utcToLaDateInput(new Date())).getTime();
}

const uuid = z.string().uuid("Invalid identifier.");

export const uploadRequestSchema = z.object({
  definitionId: uuid,
  fileName: z.string().trim().min(1, "File name is required.").max(200, "File name is too long."),
  contentType: z.enum(ALLOWED_PROOF_TYPES, {
    error: "Unsupported file type. Upload a PDF, PNG, JPEG, WebP or HEIC file.",
  }),
  size: z
    .number()
    .int()
    .positive("The selected file is empty.")
    .max(MAX_PROOF_BYTES, `File is too large (max ${MAX_PROOF_BYTES / 1024 / 1024} MB).`),
});
export type UploadRequestInput = z.input<typeof uploadRequestSchema>;

export const submitCredentialSchema = z
  .object({
    definitionId: uuid,
    issuerPartner: z.string().trim().min(1, "Issuer is required.").max(120, "Issuer is too long."),
    // Reference/confirmation number only. Never an SSN or report contents.
    referenceNumber: z
      .string()
      .trim()
      .min(1, "Reference number is required.")
      .max(100, "Reference number is too long.")
      .refine((v) => !SSN_LIKE.test(v), "That looks like a Social Security number. Enter only the confirmation or reference number."),
    issuedAt: z.coerce.date({ error: "Issue date is required." }),
    expiresAt: z.coerce.date({ error: "Invalid expiration date." }).optional(),
    proofObjectKey: z.string().min(1, "Proof upload is required.").max(500),
  })
  .refine((v) => v.issuedAt.getTime() <= endOfTodayLa(), {
    path: ["issuedAt"],
    message: "Issue date cannot be in the future.",
  })
  .refine((v) => !v.expiresAt || v.expiresAt.getTime() > v.issuedAt.getTime(), {
    path: ["expiresAt"],
    message: "Expiration must be after the issue date.",
  });
export type SubmitCredentialInput = z.input<typeof submitCredentialSchema>;

export const reviewSchema = z
  .object({
    decision: z.enum(["verified", "rejected"]),
    reviewerNotes: z.string().trim().max(2000, "Notes are too long (max 2000 characters).").optional(),
    expiresAt: z.coerce.date({ error: "Invalid expiration date." }).optional(),
  })
  .refine((v) => v.decision !== "rejected" || !!v.reviewerNotes, {
    path: ["reviewerNotes"],
    message: "Notes are required when rejecting a credential.",
  })
  .refine((v) => !v.expiresAt || v.decision === "verified", {
    path: ["expiresAt"],
    message: "Expiration can only be set when approving.",
  });
export type ReviewInput = z.input<typeof reviewSchema>;

export const queueFilterSchema = z.enum(["all", "pending_review", "verified", "expiring", "expired", "rejected"]);
export type QueueFilter = z.infer<typeof queueFilterSchema>;
