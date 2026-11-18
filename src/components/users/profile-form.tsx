"use client";

import { useEffect } from "react";
import { Button, Field, Input, useToast } from "@/components/ui";
import { updateProfileAction } from "@/app/(admin)/admin/users/[id]/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { formatPhone } from "@/lib/validation/household";

export function UserProfileForm({
  userId,
  name,
  email,
  phone,
}: {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(updateProfileAction);

  useEffect(() => {
    if (state?.ok) toast.success("Profile saved");
  }, [state, toast]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="name" required maxLength={100} defaultValue={name} />
        </Field>
        <Field label="Phone" hint="Optional. Saved in international format.">
          <Input name="phone" type="tel" maxLength={30} defaultValue={formatPhone(phone)} placeholder="(541) 555-0123" />
        </Field>
        <Field label="Email" hint="Email is the sign-in identity and can't be edited.">
          <Input value={email} readOnly disabled />
        </Field>
      </div>
      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
