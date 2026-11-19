import "server-only";
import type Stripe from "stripe";
import type { DbTx } from "@/db";

/**
 * Refunds, disputes and the payment ledger (worker PC implements).
 * CONTRACTS used by the webhook (worker PB), called inside the webhook's
 * transaction (which also inserted the webhook_events idempotency row):
 * keep these signatures. `accountId` = event.account (null = platform).
 */
export async function handleChargeRefunded(tx: DbTx, charge: Stripe.Charge, accountId: string | null): Promise<void> {
  void tx;
  void charge;
  void accountId;
  throw new Error("handleChargeRefunded not implemented yet");
}

export async function handleDisputeEvent(
  tx: DbTx,
  dispute: Stripe.Dispute,
  accountId: string | null,
  phase: "opened" | "closed"
): Promise<void> {
  void tx;
  void dispute;
  void accountId;
  void phase;
  throw new Error("handleDisputeEvent not implemented yet");
}
