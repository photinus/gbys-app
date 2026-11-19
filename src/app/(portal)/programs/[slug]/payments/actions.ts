"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { refreshAccountStatus, setPlatformFee, startOnboarding } from "@/lib/dal/stripe-connect";
import { parseDollarsToCents, parsePercentToBps, platformFeeSchema } from "@/lib/validation/payments-settings";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Creates the connected account (once) and returns the Stripe-hosted onboarding URL. */
export async function startOnboardingAction(programId: string): Promise<ActionResult<{ url: string }>> {
  const res = await runAction(async (ctx) => {
    const { url, slug } = await startOnboarding(ctx, String(programId));
    revalidatePath(`/programs/${slug}/payments`);
    return { url };
  });
  return res;
}

/** "Check status": pulls the account from Stripe and syncs the program. */
export async function refreshStatusAction(programId: string): Promise<ActionResult<{ ready: boolean }>> {
  const res = await runAction(async (ctx) => {
    const r = await refreshAccountStatus(ctx, String(programId));
    revalidatePath(`/programs/${r.slug}/payments`);
    return { ready: r.onboardingComplete };
  });
  return res;
}

/** Board only (enforced in the DAL). Fields: programId, flatDollars, percent. */
export async function setPlatformFeeAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ slug: string }>> {
  const programId = str(fd, "programId");
  const res = await runAction(async (ctx) => {
    const input = {
      flatCents: parseDollarsToCents(str(fd, "flatDollars")),
      bps: parsePercentToBps(str(fd, "percent")),
    };
    platformFeeSchema.parse(input); // friendly first-issue message
    return setPlatformFee(ctx, programId, input);
  });
  if (res.ok) {
    revalidatePath(`/programs/${res.data.slug}/payments`);
    revalidatePath(`/admin/programs/${programId}`);
  }
  return res;
}
