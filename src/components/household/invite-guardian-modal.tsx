"use client";

import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Field, Input, Label, Modal, Select, Switch, useToast } from "@/components/ui";
import { createInviteAction } from "@/app/(portal)/household/actions";
import type { AthleteListItem } from "@/lib/dal/households";
import { FormError } from "./form-error";
import { useActionForm } from "./use-action-form";

/** Button + modal. Only athletes the viewer can manage (canRegister) are offered. */
export function InviteGuardianButton({ athletes }: { athletes: AthleteListItem[] }) {
  const [open, setOpen] = useState(false);
  const manageable = athletes.filter((a) => a.canRegister);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={manageable.length === 0}>
        <UserPlus className="h-4 w-4" /> Invite guardian
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Invite a co-guardian"
        description="They will get an email link that works for 7 days. They must sign in with the invited email address."
      >
        <InviteForm athletes={manageable} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function InviteForm({ athletes, onDone }: { athletes: AthleteListItem[]; onDone: () => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(createInviteAction);

  useEffect(() => {
    if (!state?.ok) return;
    if (state.data.emailSent) toast.success("Invitation sent");
    else toast.error("Invitation created, but the email could not be sent", "Revoke it and try again.");
    onDone();
  }, [state, toast, onDone]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <Field label="Guardian's email">
        <Input name="email" type="email" required autoComplete="off" placeholder="name@example.com" />
      </Field>
      <Field label="Relationship to the athletes">
        <Select name="relationship" defaultValue="Parent">
          <option>Parent</option>
          <option>Legal Guardian</option>
          <option>Grandparent</option>
          <option>Other</option>
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1 text-xs font-semibold text-stone-600">Athletes</legend>
        <div className="space-y-1.5">
          {athletes.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-alabaster/50 px-3.5 py-2.5"
            >
              <input
                type="checkbox"
                name="athleteId"
                value={a.id}
                defaultChecked={athletes.length === 1}
                className="h-4 w-4 accent-charcoal"
              />
              <span className="text-sm font-medium text-charcoal">
                {a.firstName} {a.lastName}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2.5">
        <legend className="mb-1 text-xs font-semibold text-stone-600">Permissions</legend>
        {[
          { name: "canRegister", label: "Can register and edit athletes" },
          { name: "canSignWaivers", label: "Can sign waivers" },
          { name: "receivesComms", label: "Receives program emails" },
        ].map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-4">
            <Label htmlFor={`perm-${p.name}`} className="mb-0 text-sm font-medium text-charcoal">
              {p.label}
            </Label>
            <Switch id={`perm-${p.name}`} name={p.name} defaultChecked />
          </div>
        ))}
      </fieldset>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending..." : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}
