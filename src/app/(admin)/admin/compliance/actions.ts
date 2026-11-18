"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { getCredentialProofUrl, reviewCredential } from "@/lib/dal/compliance";
import type { ReviewInput } from "@/lib/validation/compliance";

// Authorization (board-only, not own credential, pending only) is enforced inside the DAL.

export async function reviewCredentialAction(
  credentialId: string,
  input: ReviewInput
): Promise<ActionResult<{ status: "verified" | "rejected" | "pending_review" | "expired" }>> {
  const result = await runAction((ctx) => reviewCredential(ctx, credentialId, input));
  if (result.ok) {
    revalidatePath("/admin/compliance");
    revalidatePath("/volunteer/credentials");
  }
  return result;
}

/** Returns a short-lived presigned URL; each call writes a credential.proof_viewed audit row. */
export async function getProofUrlAction(credentialId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(async (ctx) => ({ url: await getCredentialProofUrl(ctx, credentialId) }));
}
