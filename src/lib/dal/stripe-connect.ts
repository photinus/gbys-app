import "server-only";
import type Stripe from "stripe";

/**
 * Stripe Connect onboarding + program payment settings (worker PA implements).
 * CONTRACT used by the webhook (worker PB): keep this signature.
 */
export async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  void account;
  throw new Error("handleAccountUpdated not implemented yet");
}
