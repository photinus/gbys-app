"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { ManagedRole } from "@/lib/dal/volunteer-roles";
import type { RoleActions } from "./types";

export interface AssignTerms {
  /** Seasons per program id ("" = org-wide) and the current LA year. */
  seasonsByProgram: Record<string, { id: string; name: string }[]>;
  currentYear: number;
}

export function AssignModal({
  open,
  onClose,
  roles,
  initialRoleId,
  terms,
  action,
}: {
  open: boolean;
  onClose: () => void;
  roles: ManagedRole[];
  initialRoleId?: string | null;
  terms: AssignTerms;
  action: RoleActions["assign"];
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign volunteer"
      description="Adds them to the role as active right away. They must have signed in to GBYS once."
    >
      <AssignForm roles={roles} initialRoleId={initialRoleId} terms={terms} action={action} onDone={onClose} />
    </Modal>
  );
}

function AssignForm({
  roles,
  initialRoleId,
  terms,
  action,
  onDone,
}: {
  roles: ManagedRole[];
  initialRoleId?: string | null;
  terms: AssignTerms;
  action: RoleActions["assign"];
  onDone: () => void;
}) {
  const toast = useToast();
  const assignable = roles.filter((r) => r.isActive && r.canManage);
  const { state, pending, onSubmit } = useActionForm(action);
  const [roleId, setRoleId] = useState(assignable.find((r) => r.id === initialRoleId)?.id ?? assignable[0]?.id ?? "");
  const role = assignable.find((r) => r.id === roleId);
  const seasons = role ? (terms.seasonsByProgram[role.programId ?? ""] ?? []) : [];

  useEffect(() => {
    if (!state?.ok) return;
    const miss = state.data.missingCredentials;
    toast.success("Volunteer assigned", miss.length ? `Missing credentials: ${miss.join(", ")}` : undefined);
    onDone();
  }, [state, toast, onDone]);

  if (assignable.length === 0) return <p className="text-sm text-stone-500">Create an active role first.</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <Field label="Role">
        <Select name="roleId" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {assignable.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.programName ? ` (${r.programName})` : " (org-wide)"}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Volunteer's email">
        <Input name="email" type="email" required autoComplete="off" placeholder="volunteer@example.com" />
      </Field>
      {role?.period === "per_season" ? (
        <Field label="Season" hint={seasons.length === 0 ? "This program has no active, current seasons." : undefined}>
          <Select name="seasonId" required key={`s-${roleId}`}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Year">
          <Select name="year" key={`y-${roleId}`} defaultValue={String(terms.currentYear)}>
            <option value={terms.currentYear}>{terms.currentYear}</option>
            <option value={terms.currentYear + 1}>{terms.currentYear + 1}</option>
          </Select>
        </Field>
      )}
      <Field label="Note (optional)">
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (role?.period === "per_season" && seasons.length === 0)}>
          {pending ? "Assigning..." : "Assign"}
        </Button>
      </div>
    </form>
  );
}
