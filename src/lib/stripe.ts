import "server-only";
import Stripe from "stripe";

/**
 * Shared Stripe contract (orchestrator-owned). Decisions:
 * - GBYS-run programs charge on the GBYS platform account.
 * - Independent partner programs use DIRECT charges on their own Standard
 *   connected account ({ stripeAccount: acct_… }); the league is merchant of
 *   record and GBYS may take a board-configured application fee.
 * - Programs absorb Stripe processing fees (families pay the posted fee).
 * Without STRIPE_SECRET_KEY the app stays offline-payments-only.
 */
export const STRIPE_API_VERSION = "2025-02-24.acacia" as const;

let client: Stripe | null = null;

export function isStripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** Lazily constructed client; throws only when called without a key. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  client ??= new Stripe(key, { apiVersion: STRIPE_API_VERSION, typescript: true, maxNetworkRetries: 2 });
  return client;
}

/** Test seam: workers' tests inject a fake client. */
export function __setStripeForTests(fake: Stripe | null): void {
  client = fake;
}

/**
 * GBYS application fee for a partner registration: flat + bps of the amount,
 * rounded to the cent, never negative and always strictly below the amount
 * (so the league always receives something). Zero for non-partner programs.
 */
export function computePlatformFeeCents(
  amountCents: number,
  program: { isIndependentPartner: boolean; platformFeeCents: number; platformFeeBps: number }
): number {
  if (!program.isIndependentPartner || amountCents <= 0) return 0;
  const fee = program.platformFeeCents + Math.round((amountCents * program.platformFeeBps) / 10_000);
  return Math.max(0, Math.min(fee, amountCents - 1));
}

export type PaymentRoute =
  | { ready: true; stripeAccountId: string | null } // null = platform account
  | { ready: false; reason: "stripe_disabled" | "partner_not_connected" | "partner_not_ready" };

/** Where a program's card payments go, and whether they can be taken right now. */
export function paymentRouteFor(program: {
  isIndependentPartner: boolean;
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean;
}): PaymentRoute {
  if (!isStripeEnabled()) return { ready: false, reason: "stripe_disabled" };
  if (!program.isIndependentPartner) return { ready: true, stripeAccountId: null };
  if (!program.stripeAccountId) return { ready: false, reason: "partner_not_connected" };
  if (!program.stripeOnboardingComplete) return { ready: false, reason: "partner_not_ready" };
  return { ready: true, stripeAccountId: program.stripeAccountId };
}

/** Request options for a direct charge on a connected account (or the platform). */
export function stripeRequestOptions(stripeAccountId: string | null): Stripe.RequestOptions {
  return stripeAccountId ? { stripeAccount: stripeAccountId } : {};
}
