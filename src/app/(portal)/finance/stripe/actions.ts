"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { importRecentPayouts, retryPayout, runPostPendingNow } from "@/lib/dal/finance-autopost";

/** "Post pending payments now" (finance editor, enforced in the DAL). */
export async function postPendingAction(): Promise<ActionResult<{ posted: number; skipped: number; failed: number }>> {
  const res = await runAction((ctx) => runPostPendingNow(ctx));
  if (res.ok) {
    revalidatePath("/finance/stripe");
    revalidatePath("/finance/journal");
  }
  return res;
}

/** "Import recent payouts": last 30 days of platform-account payouts. */
export async function importPayoutsAction(): Promise<ActionResult<{ imported: number; failed: number }>> {
  const res = await runAction((ctx) => importRecentPayouts(ctx));
  if (res.ok) {
    revalidatePath("/finance/stripe");
    revalidatePath("/finance/journal");
  }
  return res;
}

export async function retryPayoutAction(payoutId: string): Promise<ActionResult<void>> {
  const res = await runAction((ctx) => retryPayout(ctx, String(payoutId)));
  if (res.ok) {
    revalidatePath("/finance/stripe");
    revalidatePath("/finance/journal");
  }
  return res;
}
