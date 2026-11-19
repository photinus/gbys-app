"use client";

import { CreditCard } from "lucide-react";
import { useState, useTransition } from "react";
import { startCheckoutAction } from "@/app/(portal)/registrations/actions";
import { Button, type ButtonVariant } from "@/components/ui";
import { formatCents } from "@/lib/format";

/** Starts Stripe-hosted Checkout and sends the parent there. Never marks anything paid itself. */
export function PayNowButton({
  registrationId,
  amountCents,
  size = "sm",
  variant = "primary",
}: {
  registrationId: string;
  amountCents?: number;
  size?: "sm" | "md";
  variant?: ButtonVariant;
}) {
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [pending, startTransition] = useTransition();

  function pay() {
    setError(null);
    startTransition(async () => {
      const res = await startCheckoutAction(registrationId);
      if (res.ok) {
        setRedirecting(true);
        window.location.assign(res.data.url);
      } else setError(res.error);
    });
  }

  const busy = pending || redirecting;
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1.5">
      <Button size={size} variant={variant} onClick={pay} disabled={busy} data-testid="pay-now">
        <CreditCard className="h-4 w-4" aria-hidden />
        {busy ? "Opening checkout..." : amountCents ? `Pay now ${formatCents(amountCents)}` : "Pay now"}
      </Button>
      {error ? (
        <span role="alert" className="break-words text-xs font-medium text-rose-800">
          {error}
        </span>
      ) : null}
    </span>
  );
}
