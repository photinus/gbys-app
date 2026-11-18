"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { getSignedWaiver, withdrawRegistration, type SignedWaiverView } from "@/lib/dal/registrations";

export async function withdrawRegistrationAction(registrationId: string): Promise<ActionResult> {
  const res = await runAction((ctx) => withdrawRegistration(ctx, String(registrationId)));
  if (res.ok) {
    revalidatePath("/registrations");
    revalidatePath("/register/[slug]", "page");
  }
  return res;
}

export async function fetchSignedWaiverAction(registrationId: string): Promise<ActionResult<SignedWaiverView>> {
  return runAction((ctx) => getSignedWaiver(ctx, String(registrationId)));
}
