"use client";

import { useEffect } from "react";
import { saveContentAction } from "@/app/(portal)/programs/[slug]/home-page/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Select, Switch, Textarea, useToast } from "@/components/ui";
import { SITE_LIMITS } from "@/lib/validation/program-sites";

export interface ContentValues {
  headline: string;
  tagline: string;
  about: string;
  showOpenRegistrations: boolean;
  contactEmail: string;
  contactPhone: string;
  contactFormId: string | null;
  seoDescription: string;
}

export function ContentForm({
  programId,
  programName,
  values,
  contactForms,
}: {
  programId: string;
  programName: string;
  values: ContentValues;
  contactForms: { id: string; title: string; slug: string }[];
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(saveContentAction);
  useEffect(() => {
    if (state?.ok) toast.success(state.data.changed.length ? "Page content saved" : "No changes to save");
  }, [state, toast]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm" data-testid="content-form">
      <input type="hidden" name="programId" value={programId} />
      <Field label="Headline" hint={`The big title at the top. Leave blank to use "${programName}".`}>
        <Input name="headline" maxLength={SITE_LIMITS.headline} defaultValue={values.headline} placeholder={programName} />
      </Field>
      <Field label="Tagline" hint="One short line under the headline, like “Ages 5 to 12. Fun first.”">
        <Input name="tagline" maxLength={SITE_LIMITS.tagline} defaultValue={values.tagline} />
      </Field>
      <Field
        label="About your program"
        hint="Plain text only. Leave a blank line between paragraphs. Web addresses become links automatically."
      >
        <Textarea name="about" rows={8} maxLength={SITE_LIMITS.about} defaultValue={values.about} />
      </Field>

      <div className="rounded-2xl bg-alabaster px-4 py-3">
        <label className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-charcoal">Show open registrations</span>
            <span className="block text-xs text-stone-500">
              Lists this program&apos;s seasons that are open for sign-up, with Register buttons.
            </span>
          </span>
          <Switch name="showOpenRegistrations" defaultChecked={values.showOpenRegistrations} aria-label="Show open registrations" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact email (optional)" hint="Shown on the page as a mailto link. Public, so use a shared address.">
          <Input name="contactEmail" type="email" maxLength={SITE_LIMITS.email} defaultValue={values.contactEmail} />
        </Field>
        <Field label="Contact phone (optional)">
          <Input name="contactPhone" type="tel" maxLength={SITE_LIMITS.phone} defaultValue={values.contactPhone} />
        </Field>
      </div>

      <Field
        label="Contact form (optional)"
        hint={
          contactForms.length === 0
            ? "This program has no active contact form yet. Create one under the program's Contact page."
            : "Adds a “Contact us” button that opens one of this program's contact forms."
        }
      >
        <Select name="contactFormId" defaultValue={values.contactFormId ?? ""}>
          <option value="">No contact form</option>
          {contactForms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Search engine description (optional)" hint="A sentence or two shown in Google results and link previews. Leave blank to use the tagline.">
        <Textarea name="seoDescription" rows={2} maxLength={SITE_LIMITS.seoDescription} defaultValue={values.seoDescription} />
      </Field>

      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} data-testid="save-content">
          {pending ? "Saving..." : "Save content"}
        </Button>
      </div>
    </form>
  );
}
