"use client";

import { Check, Info, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MyRegistration } from "@/lib/dal/registrations";

const POLL_MS = 3000;
const MAX_POLLS = 10; // about 30 s

/**
 * Banner for the Stripe Checkout return. The success URL proves nothing: the
 * state shown comes only from the registration row, which the signed webhook
 * updates. While it still says unpaid/pending we refresh the page data every
 * few seconds (about 30 s) and show "processing".
 */
export function CheckoutReturn({
  result,
  registration,
}: {
  result: "success" | "cancelled";
  /** The registration this checkout session belongs to, when it could be matched. */
  registration: Pick<MyRegistration, "athleteName" | "paymentStatus" | "checkoutSessionId"> | null;
}) {
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const settled = registration?.paymentStatus === "paid" || registration?.paymentStatus === "refunded";
  const waiting = result === "success" && !!registration && !settled && registration.checkoutSessionId !== null;

  useEffect(() => {
    if (!waiting || polls >= MAX_POLLS) return;
    const t = setTimeout(() => {
      setPolls((n) => n + 1);
      router.refresh();
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [waiting, polls, router]);

  if (result === "cancelled") {
    return (
      <div role="status" data-testid="checkout-cancelled" className="flex items-start gap-3 rounded-2xl border border-line bg-alabaster p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden />
        <p className="text-sm text-stone-700">
          Checkout was cancelled and you were not charged. You can pay any time with the Pay now button below.
        </p>
      </div>
    );
  }

  if (settled) {
    return (
      <div role="status" data-testid="checkout-paid" className="flex items-start gap-3 rounded-2xl bg-mint-card p-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage/50 text-emerald-900">
          <Check className="h-4 w-4" aria-hidden />
        </span>
        <p className="text-sm font-semibold text-charcoal">
          Payment received{registration ? ` for ${registration.athleteName}` : ""}. Thank you!
        </p>
      </div>
    );
  }

  if (waiting) {
    const slow = polls >= MAX_POLLS;
    return (
      <div role="status" data-testid="checkout-processing" className="flex items-start gap-3 rounded-2xl border border-line bg-alabaster p-4">
        {slow ? (
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden />
        ) : (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-stone-500" aria-hidden />
        )}
        <p className="text-sm text-stone-700">
          {slow
            ? "Your payment is still being confirmed. This can take a few minutes. Refresh this page later; you do not need to pay again."
            : `Payment processing... confirming your payment${registration ? ` for ${registration.athleteName}` : ""} with Stripe.`}
        </p>
      </div>
    );
  }

  // Returned from Stripe but the session is no longer current (payment failed, expired or was cleared).
  return (
    <div role="status" data-testid="checkout-unknown" className="flex items-start gap-3 rounded-2xl border border-line bg-alabaster p-4">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden />
      <p className="text-sm text-stone-700">
        We could not match that checkout to a pending payment. Your registrations below show the current status.
      </p>
    </div>
  );
}
