"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { withdrawClaimAction } from "@/app/(portal)/reimbursements/actions";
import { useRunner } from "@/components/finance/banking/use-runner";
import { Button, Modal } from "@/components/ui";

export function WithdrawClaimButton({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending, error, setError } = useRunner({ inline: true });
  const close = () => {
    setOpen(false);
    setError(null);
  };
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="withdraw-claim">
        Withdraw this claim
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Withdraw this claim?"
        description="It will be cancelled and nobody will review it. You can send a new claim any time."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              data-testid="withdraw-confirm"
              onClick={() =>
                run(
                  () => withdrawClaimAction(claimId),
                  () => {
                    close();
                    router.refresh();
                    return "Claim withdrawn";
                  }
                )
              }
            >
              {pending ? "Withdrawing..." : "Withdraw"}
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
            {error}
          </p>
        ) : (
          <p className="text-sm text-stone-600">Only claims that are still waiting for review can be withdrawn.</p>
        )}
      </Modal>
    </>
  );
}
