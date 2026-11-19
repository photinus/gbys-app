"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { voidEntryAction } from "@/app/(portal)/finance/journal/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Modal, Textarea, useToast } from "@/components/ui";

export function VoidEntryButton({ entryId, entryNumber, hasBankLink }: { entryId: string; entryNumber: number; hasBankLink: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(voidEntryAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success(`Entry #${entryNumber} voided`);
      setOpen(false);
      router.refresh();
    }
  }, [state, toast, router, entryNumber]);

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)} data-testid="void-open">
        Void entry
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Void entry #${entryNumber}?`}
        description="Voiding keeps the entry on record but removes it from all balances and reports."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep entry
            </Button>
            <Button variant="danger" type="submit" form="void-entry-form" disabled={pending} data-testid="void-confirm">
              {pending ? "Voiding..." : "Void entry"}
            </Button>
          </>
        }
      >
        <form id="void-entry-form" onSubmit={onSubmit} className="space-y-4 text-sm">
          <input type="hidden" name="entryId" value={entryId} />
          {hasBankLink ? (
            <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950">
              This entry is linked to a bank transaction. It will go back to the bank inbox so it can be categorized again.
            </p>
          ) : null}
          <Field label="Reason" hint="Shown in the history, e.g. “Entered twice”.">
            <Textarea name="reason" required minLength={3} maxLength={500} rows={3} />
          </Field>
          <FormError state={state} />
        </form>
      </Modal>
    </>
  );
}
