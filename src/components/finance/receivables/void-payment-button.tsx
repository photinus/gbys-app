"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { voidPaymentAction } from "@/app/(portal)/finance/receivables/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Modal, Textarea, useToast } from "@/components/ui";

export function VoidPaymentButton({ paymentId, label, hasBankLink }: { paymentId: string; label: string; hasBankLink?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(voidPaymentAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success("Payment voided");
      setOpen(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const formId = `void-payment-${paymentId}`;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} data-testid="void-payment-open" className="text-rose-700">
        Void
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Void this payment?"
        description={`${label}. The invoices it paid go back to owing the amount.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep payment
            </Button>
            <Button variant="danger" type="submit" form={formId} disabled={pending} data-testid="void-payment-confirm">
              {pending ? "Voiding..." : "Void payment"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="space-y-4 text-sm">
          <input type="hidden" name="paymentId" value={paymentId} />
          {hasBankLink ? (
            <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950">
              This payment is linked to a bank transaction. It will go back to the bank inbox.
            </p>
          ) : null}
          <Field label="Reason" hint="Shown in the history, e.g. “Check bounced”.">
            <Textarea name="reason" required minLength={3} maxLength={500} rows={3} data-testid="void-payment-reason" />
          </Field>
          <FormError state={state} />
        </form>
      </Modal>
    </>
  );
}
