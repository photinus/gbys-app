"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { voidPaymentAction } from "@/app/(portal)/finance/payables/actions";
import { useRunner } from "@/components/finance/banking/use-runner";
import { Button, Field, Modal, Textarea } from "@/components/ui";

export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending, error, setError } = useRunner({ inline: true });
  const close = () => {
    setOpen(false);
    setReason("");
    setError(null);
  };
  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)} data-testid="void-payment">
        Void payment
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Void this payment?"
        description="The bills it paid go back to unpaid (or partly paid), and a bank transaction linked to it returns to the bank inbox."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending || reason.trim().length < 3}
              data-testid="void-payment-confirm"
              onClick={() =>
                run(
                  () => voidPaymentAction(paymentId, reason),
                  () => {
                    close();
                    router.refresh();
                    return "Payment voided";
                  }
                )
              }
            >
              {pending ? "Voiding..." : "Void payment"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Why are you voiding it?" hint="Required.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} data-testid="void-payment-reason" />
          </Field>
          {error ? (
            <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
