"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Modal, useToast } from "@/components/ui";
import { removeLogoAction, updateSettingsAction, uploadLogoAction } from "@/app/(admin)/admin/settings/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { OrgSettingsView } from "@/lib/dal/settings";
import { LOGO_MAX_BYTES } from "@/lib/validation/settings";

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export function ProfileForm({ settings: s }: { settings: OrgSettingsView }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(updateSettingsAction);
  useEffect(() => {
    if (state?.ok) toast.success(state.data.changed.length ? "Organization profile saved" : "No changes to save");
  }, [state, toast]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="section" value="profile" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organization name">
          <Input name="orgName" required minLength={2} maxLength={80} defaultValue={s.orgName} />
        </Field>
        <Field label="Short name" hint="Shown in tight spaces and page titles (2 to 12 characters).">
          <Input name="shortName" required minLength={2} maxLength={12} defaultValue={s.shortName} />
        </Field>
        <Field label="Legal designation">
          <Input name="legalDesignation" required maxLength={120} defaultValue={s.legalDesignation} />
        </Field>
        <Field label="EIN (optional)" hint="Format 12-3456789. Printed on grant summaries.">
          <Input name="ein" inputMode="numeric" maxLength={10} placeholder="12-3456789" defaultValue={s.ein ?? ""} />
        </Field>
        <Field label="Support email (optional)">
          <Input name="supportEmail" type="email" maxLength={254} defaultValue={s.supportEmail ?? ""} />
        </Field>
        <Field label="Website (optional)" hint="Must start with https://">
          <Input name="websiteUrl" type="url" maxLength={300} placeholder="https://" defaultValue={s.websiteUrl ?? ""} />
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

export function RateForm({ settings: s }: { settings: OrgSettingsView }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(updateSettingsAction);
  useEffect(() => {
    if (state?.ok) toast.success(state.data.changed.length ? "Valuation saved" : "No changes to save");
  }, [state, toast]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="section" value="valuation" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Hourly rate (USD)"
          hint={`Leave blank to use the default from the environment (${(s.defaultRateCents / 100).toFixed(2)}). Allowed: 1.00 to 500.00.`}
        >
          <Input
            name="inKindRateDollars"
            inputMode="decimal"
            placeholder={(s.defaultRateCents / 100).toFixed(2)}
            defaultValue={dollars(s.inKindHourlyRateCents)}
          />
        </Field>
        <Field label="Rate source (optional)" hint="e.g. Independent Sector 2025, Oregon">
          <Input name="inKindRateSource" maxLength={200} defaultValue={s.inKindRateSource ?? ""} />
        </Field>
      </div>
      <p className="rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600">
        New volunteer hours snapshot the rate in effect when they are logged. Existing ledger entries keep the rate they
        were recorded with, so changing it never rewrites past grant reports.
      </p>
      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save valuation"}
        </Button>
      </div>
    </form>
  );
}

export function LogoCard({ logoUrl, logoUpdatedAt }: { logoUrl: string | null; logoUpdatedAt: string | null }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useActionForm(uploadLogoAction);
  const [clientError, setClientError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Logo updated");
      formRef.current?.reset();
    }
  }, [state, toast]);

  function check(e: React.FormEvent<HTMLFormElement>) {
    const file = new FormData(e.currentTarget).get("logo");
    if (!(file instanceof File) || file.size === 0) {
      e.preventDefault();
      setClientError("Choose an image file first.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      e.preventDefault();
      setClientError("Logo must be 512 KB or smaller.");
      return;
    }
    setClientError(null);
    onSubmit(e);
  }

  async function remove() {
    setRemoving(true);
    setRemoveError(null);
    const res = await removeLogoAction();
    setRemoving(false);
    if (res.ok) {
      setConfirmRemove(false);
      toast.success("Logo removed");
    } else {
      setRemoveError(res.error);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-alabaster">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Current logo" className="h-full w-full object-contain" data-testid="logo-preview" />
          ) : (
            <span className="px-2 text-center text-xs text-stone-400">Built-in emblem</span>
          )}
        </div>
        <div className="min-w-0 text-xs text-stone-500">
          <p>Recommended: a square PNG of at least 256 px. PNG, JPEG or WebP, up to 512 KB. SVG is not accepted.</p>
          {logoUpdatedAt ? <p className="mt-1">Last updated {logoUpdatedAt}</p> : null}
        </div>
      </div>
      <form ref={formRef} onSubmit={check} className="space-y-3">
        <Field label="Upload a new logo">
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp"
            className="block w-full max-w-full text-sm text-stone-600 file:mr-3 file:rounded-full file:border-0 file:bg-alabaster file:px-4 file:py-2 file:text-xs file:font-semibold file:text-charcoal"
          />
        </Field>
        {clientError ? (
          <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
            {clientError}
          </p>
        ) : null}
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2.5">
          {logoUrl ? (
            <Button variant="danger" onClick={() => setConfirmRemove(true)}>
              Remove logo
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Uploading..." : "Upload logo"}
          </Button>
        </div>
      </form>
      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove logo?"
        description="The built-in emblem will be shown instead."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} disabled={removing}>
              {removing ? "Removing..." : "Remove logo"}
            </Button>
          </>
        }
      >
        {removeError ? (
          <p role="alert" className="text-xs font-medium text-rose-900">
            {removeError}
          </p>
        ) : (
          <p className="text-sm text-stone-600">Visitors and signed-in users will see the default emblem.</p>
        )}
      </Modal>
    </div>
  );
}
