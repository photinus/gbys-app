"use client";

import { useEffect } from "react";
import { Button, Field, Input, Label, Switch, Textarea, useToast } from "@/components/ui";
import { updateProgramAction } from "@/app/(admin)/admin/programs/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { CredentialOption, ProgramAdminRow } from "@/lib/dal/programs";
import { CredentialPicker } from "./credential-picker";

export function ProgramEditForm({
  program,
  credentials,
}: {
  program: ProgramAdminRow;
  credentials: CredentialOption[];
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(updateProgramAction);

  useEffect(() => {
    if (state?.ok) toast.success("Program saved");
  }, [state, toast]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="id" value={program.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" required maxLength={120} defaultValue={program.name} />
        </Field>
        <Field label="Slug" hint="Lowercase letters, numbers and hyphens. Must be unique.">
          <Input name="slug" required maxLength={60} defaultValue={program.slug} />
        </Field>
        <Field label="Sport">
          <Input name="sport" required maxLength={60} defaultValue={program.sport} />
        </Field>
        <div className="space-y-3 pt-6">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="edit-partner" className="mb-0 text-sm font-medium text-charcoal">
              Independent partner league
            </Label>
            <Switch id="edit-partner" name="isIndependentPartner" defaultChecked={program.isIndependentPartner} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="edit-active" className="mb-0 text-sm font-medium text-charcoal">
              Active
            </Label>
            <Switch id="edit-active" name="isActive" defaultChecked={program.isActive} />
          </div>
        </div>
      </div>
      <Field label="Description">
        <Textarea name="description" rows={3} maxLength={2000} defaultValue={program.description ?? ""} />
      </Field>
      <CredentialPicker options={credentials} defaultSelected={program.requiredCredentialIds} />
      <div className="rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600">
        Stripe payments:{" "}
        <span className="font-semibold text-charcoal">
          {program.stripeConnected
            ? program.stripeOnboardingComplete
              ? "Connected, onboarding complete"
              : "Connected, onboarding incomplete"
            : "Not connected (routes to the GBYS account)"}
        </span>
        . Managed in a later release.
      </div>
      <FormError state={state} />
      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
