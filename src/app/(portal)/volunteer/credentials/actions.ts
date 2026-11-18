"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { createProofUploadUrl, submitCredential } from "@/lib/dal/compliance";
import type { SubmitCredentialInput, UploadRequestInput } from "@/lib/validation/compliance";

/** Step 1 of the upload flow: validates type/size, returns a short-lived presigned PUT URL. */
export async function createProofUploadUrlAction(
  input: UploadRequestInput
): Promise<ActionResult<{ uploadUrl: string; objectKey: string }>> {
  return runAction((ctx) => createProofUploadUrl(ctx, input));
}

/** Step 3: record the credential (after the browser PUT succeeded). */
export async function submitCredentialAction(
  input: SubmitCredentialInput
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction((ctx) => submitCredential(ctx, input));
  if (result.ok) {
    revalidatePath("/volunteer/credentials");
    revalidatePath("/admin/compliance");
  }
  return result;
}
