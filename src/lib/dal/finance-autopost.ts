import "server-only";
import type Stripe from "stripe";
import type { DbTx } from "@/db";

/**
 * CONTRACT STUB (workstream FC replaces the bodies, keeps the signatures).
 * Posts GBYS-run registration money and Stripe fees/payouts into the general ledger.
 */

/** Post one payment_events row (idempotent). Never throws: failures leave it for the sweep. */
export async function postPaymentEventSafely(_tx: DbTx, _paymentEventId: string): Promise<void> {
  // FC
}

/** System sweep (cron + manual button): post every unposted payment_event on/after the auto-post start date. */
export async function postPendingPayments(): Promise<{ posted: number; skipped: number; failed: number }> {
  return { posted: 0, skipped: 0, failed: 0 };
}

/** Stripe webhook (platform account only): payout.paid / payout.failed / payout.canceled / payout.updated. */
export async function handlePayoutEvent(_tx: DbTx, _payout: Stripe.Payout, _eventType: string): Promise<void> {
  // FC
}
