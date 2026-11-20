"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createContactAction, updateContactAction } from "@/app/(portal)/finance/contacts/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import type { ContactDetail } from "@/lib/dal/finance-contacts";

export interface ContactAccountOption {
  id: string;
  label: string;
}

/** Create or edit a contact (vendor, customer and/or donor). */
export function ContactForm({
  contact,
  accounts,
  defaultRole,
}: {
  contact?: ContactDetail;
  accounts: ContactAccountOption[];
  defaultRole?: "vendor" | "customer" | "donor";
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = !!contact;
  const create = useActionForm(createContactAction);
  const update = useActionForm(updateContactAction);
  const { state, pending, onSubmit } = editing ? update : create;

  useEffect(() => {
    if (!state?.ok) return;
    if (editing) toast.success("Saved");
    else {
      toast.success("Contact added");
      router.push(`/finance/contacts/${(state.data as { id: string }).id}`);
    }
  }, [state, toast, router, editing]);

  return (
    <form onSubmit={onSubmit} className="space-y-5 text-sm" data-testid="contact-form">
      {contact ? <input type="hidden" name="contactId" value={contact.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input name="displayName" required maxLength={200} defaultValue={contact?.displayName ?? ""} />
        </Field>
        <Field label="Person or organization">
          <Select name="kind" defaultValue={contact?.kind ?? "organization"} aria-label="Person or organization">
            <option value="organization">Business or organization</option>
            <option value="individual">Person</option>
          </Select>
        </Field>
        <Field label="Email">
          <Input type="email" name="email" maxLength={254} defaultValue={contact?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <Input type="tel" name="phone" maxLength={40} defaultValue={contact?.phone ?? ""} />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wider text-stone-400">What are they to us?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle name="isVendor" label="Vendor" hint="We pay them" defaultChecked={contact?.isVendor ?? defaultRole === "vendor"} />
          <Toggle name="isCustomer" label="Customer" hint="We bill them" defaultChecked={contact?.isCustomer ?? defaultRole === "customer"} />
          <Toggle name="isDonor" label="Donor" hint="They give to us" defaultChecked={contact?.isDonor ?? defaultRole === "donor"} />
        </div>
        <Toggle name="is1099" label="Needs a 1099" hint="Independent contractors we pay $600 or more in a year (not corporations)." defaultChecked={contact?.is1099 ?? false} />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Address line 1">
          <Input name="addressLine1" maxLength={200} defaultValue={contact?.addressLine1 ?? ""} autoComplete="off" />
        </Field>
        <Field label="Address line 2">
          <Input name="addressLine2" maxLength={200} defaultValue={contact?.addressLine2 ?? ""} autoComplete="off" />
        </Field>
        <Field label="City">
          <Input name="city" maxLength={100} defaultValue={contact?.city ?? ""} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="State">
            <Input name="state" maxLength={50} defaultValue={contact?.state ?? ""} autoComplete="off" />
          </Field>
          <Field label="ZIP">
            <Input name="postalCode" maxLength={20} defaultValue={contact?.postalCode ?? ""} autoComplete="off" />
          </Field>
        </div>
      </div>

      <Field label="Usual category for their bills" hint="New bills start with this category.">
        <Select name="defaultAccountId" defaultValue={contact?.defaultAccountId ?? ""} aria-label="Usual category">
          <option value="">None</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes">
        <Textarea name="notes" rows={3} maxLength={2000} defaultValue={contact?.notes ?? ""} />
      </Field>
      {contact ? <Toggle name="isActive" label="Active" hint="Turn off to hide them from pick lists. Their history stays." defaultChecked={contact.isActive} /> : null}

      <FormError state={state} />
      <div className="flex justify-end gap-2.5">
        {!editing ? (
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={pending} data-testid="save-contact">
          {pending ? "Saving..." : editing ? "Save changes" : "Add contact"}
        </Button>
      </div>
    </form>
  );
}

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3.5">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 shrink-0 accent-charcoal" />
      <span className="min-w-0">
        <span className="block font-semibold text-charcoal">{label}</span>
        <span className="block text-xs text-stone-500">{hint}</span>
      </span>
    </label>
  );
}

