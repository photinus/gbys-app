"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@/components/ui";
import { importPayoutsAction, postPendingAction, retryPayoutAction } from "@/app/(portal)/finance/stripe/actions";

/** "Post pending payments now" + "Import recent payouts". Buttons are hidden for read-only viewers by the page. */
export function StripeActions({
  autoPostOn,
  stripeEnabled,
}: {
  autoPostOn: boolean;
  stripeEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function post() {
    setError(null);
    startTransition(async () => {
      const res = await postPendingAction();
      if (!res.ok) return setError(res.error);
      const { posted, skipped, failed } = res.data;
      toast.success(
        `Posted ${posted} payment${posted === 1 ? "" : "s"}`,
        failed ? `${failed} could not be posted. See the list below.` : skipped ? `${skipped} skipped (not GBYS money or already handled).` : undefined,
      );
      router.refresh();
    });
  }

  function importPayouts() {
    setError(null);
    startTransition(async () => {
      const res = await importPayoutsAction();
      if (!res.ok) return setError(res.error);
      toast.success(`Checked ${res.data.imported} payout${res.data.imported === 1 ? "" : "s"}`, res.data.failed ? `${res.data.failed} failed.` : undefined);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={post} disabled={pending || !autoPostOn} data-testid="post-pending">
          {pending ? "Working..." : "Post pending payments now"}
        </Button>
        <Button variant="secondary" onClick={importPayouts} disabled={pending || !stripeEnabled} data-testid="import-payouts">
          Import recent payouts
        </Button>
      </div>
      {!autoPostOn ? <p className="text-xs text-stone-500">Set an auto-post start date in Finance settings to turn auto-posting on.</p> : null}
      {!stripeEnabled ? <p className="text-xs text-stone-500">Stripe is not configured on this server, so payouts can&apos;t be imported.</p> : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RetryPayoutButton({ payoutId, disabled }: { payoutId: string; disabled?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || disabled}
      onClick={() =>
        startTransition(async () => {
          const res = await retryPayoutAction(payoutId);
          if (!res.ok) return toast.error("Retry failed", res.error);
          toast.success("Payout refreshed");
          router.refresh();
        })
      }
    >
      {pending ? "Retrying..." : "Retry"}
    </Button>
  );
}
