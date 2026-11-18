"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardHeader, Field, Input, Switch, useToast } from "@/components/ui";
import { updateProfileAction } from "@/app/(portal)/household/actions";
import type { MyProfile } from "@/lib/dal/households";
import { formatPhone } from "@/lib/validation/household";
import { FormError } from "./form-error";
import { useActionForm } from "./use-action-form";

export function ProfileCard({ profile }: { profile: MyProfile }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(updateProfileAction);
  const [smsOptIn, setSmsOptIn] = useState(profile.smsOptIn);

  useEffect(() => {
    if (state?.ok) toast.success("Profile saved");
  }, [state, toast]);

  return (
    <Card>
      <CardHeader
        title="Your profile"
        description="Contact details coaches and GBYS staff can use to reach you."
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input name="name" defaultValue={profile.name} required maxLength={100} autoComplete="name" />
          </Field>
          <Field label="Email" hint="Your sign-in email cannot be changed here.">
            <Input value={profile.email} readOnly disabled />
          </Field>
          <Field label="Mobile phone" hint="US numbers can omit the country code.">
            <Input
              name="phone"
              type="tel"
              defaultValue={formatPhone(profile.phone)}
              placeholder="(541) 555-0123"
              autoComplete="tel"
            />
          </Field>
          <div className="flex items-center justify-between gap-4 self-end rounded-xl border border-line bg-alabaster/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-charcoal">Text message updates</p>
              <p className="text-xs text-stone-500">Schedule changes and urgent alerts by SMS.</p>
            </div>
            <Switch
              name="smsOptIn"
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
              aria-label="Opt in to text message updates"
            />
          </div>
        </div>
        <FormError state={state} />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save profile"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
