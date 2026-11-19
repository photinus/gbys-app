"use client";

import { ArrowRightLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { releaseFundAction } from "@/app/(portal)/finance/donations/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { formatCents } from "@/lib/format";

/** "Release funds" for one restricted fund: amount up to its balance, date and reason. */
export function ReleaseFundsButton({ fundId, fundName, balanceCents, today }: { fundId: string; fundName: string; balanceCents: number; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(releaseFundAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success(`Released (entry #${state.data.entryNumber})`);
      setOpen(false);
      router.refresh();
    }
  }, [state, toast, router]);
  const formId = `release-${fundId}`;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={balanceCents <= 0} data-testid="release-open">
        <ArrowRightLeft className="h-4 w-4" /> Release funds
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Release funds"
        description={`Move money from “${fundName}” to the General Fund once the donor's purpose has been met.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={pending} data-testid="release-confirm">
              {pending ? "Releasing..." : "Release"}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="space-y-4 text-sm">
          <input type="hidden" name="fundId" value={fundId} />
          <p className="rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600">
            Still restricted: <strong>{formatCents(balanceCents)}</strong>. You can&apos;t release more than that.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount">
              <Input name="amount" inputMode="decimal" required placeholder="0.00" data-testid="release-amount" />
            </Field>
            <Field label="Date">
              <Input type="date" name="date" required defaultValue={today} data-testid="release-date" />
            </Field>
          </div>
          <Field label="Reason" hint="e.g. “Bought batting helmets with general funds”.">
            <Textarea name="reason" required minLength={3} maxLength={300} rows={2} data-testid="release-reason" />
          </Field>
          <FormError state={state} />
        </form>
      </Modal>
    </>
  );
}
