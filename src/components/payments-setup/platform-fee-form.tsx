"use client";

import { useEffect } from "react";
import { Button, Field, Input, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { setPlatformFeeAction } from "@/app/(portal)/programs/[slug]/payments/actions";

/** Board-only editor for a partner program's platform fee (flat dollars + percent). */
export function PlatformFeeForm({
  programId,
  flatCents,
  bps,
}: {
  programId: string;
  flatCents: number;
  bps: number;
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(setPlatformFeeAction);

  useEffect(() => {
    if (state?.ok) toast.success("Platform fee saved");
  }, [state, toast]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm" data-testid="platform-fee-form">
      <input type="hidden" name="programId" value={programId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Flat fee per registration ($)" hint="Max $100.00">
          <Input name="flatDollars" inputMode="decimal" defaultValue={(flatCents / 100).toFixed(2)} />
        </Field>
        <Field label="Percent of the registration fee (%)" hint="Max 30%, up to two decimals">
          <Input name="percent" inputMode="decimal" defaultValue={String(bps / 100)} />
        </Field>
      </div>
      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save platform fee"}
        </Button>
      </div>
    </form>
  );
}
