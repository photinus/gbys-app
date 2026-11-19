"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { refreshStatusAction, startOnboardingAction } from "@/app/(portal)/programs/[slug]/payments/actions";

/** "Connect Stripe" / "Continue setup" (redirects to Stripe-hosted onboarding) and "Check status". */
export function ConnectActions({
  programId,
  connected,
  ready,
}: {
  programId: string;
  connected: boolean;
  ready: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [pending, startTransition] = useTransition();

  const busy = pending || redirecting;

  function connect() {
    setError(null);
    startTransition(async () => {
      const res = await startOnboardingAction(programId);
      if (!res.ok) return setError(res.error);
      setRedirecting(true);
      window.location.assign(res.data.url);
    });
  }

  function check() {
    setError(null);
    startTransition(async () => {
      const res = await refreshStatusAction(programId);
      if (!res.ok) return setError(res.error);
      toast.success(res.data.ready ? "Stripe account is ready" : "Status updated", res.data.ready ? undefined : "Stripe still needs some details.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!ready ? (
          <Button onClick={connect} disabled={busy} data-testid="connect-stripe">
            {redirecting ? "Redirecting to Stripe..." : pending ? "Working..." : connected ? "Continue setup" : "Connect Stripe"}
          </Button>
        ) : null}
        {connected ? (
          <Button variant="secondary" onClick={check} disabled={busy} data-testid="check-status">
            Check status
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}
