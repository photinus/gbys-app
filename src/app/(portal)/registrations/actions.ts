"use server";

import { revalidatePath } from "next/cache";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import { createCheckoutForRegistration } from "@/lib/dal/stripe-checkout";
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

/** Starts Stripe Checkout for a registration; the client then navigates to the returned URL. */
export async function startCheckoutAction(registrationId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(async (ctx) => {
    const { url } = await createCheckoutForRegistration(ctx, String(registrationId));
    if (!/^https:\/\//i.test(url)) throw new DalError("INVALID", "Could not start checkout. Please try again.");
    return { url };
  });
}
