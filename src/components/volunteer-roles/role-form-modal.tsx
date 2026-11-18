"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Label, Modal, Select, Switch, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { ManagedRole, RoleCredentialOption } from "@/lib/dal/volunteer-roles";
import { PROGRAM_ROLES, PROGRAM_ROLE_LABELS } from "@/lib/validation/programs";
import { CATEGORY_LABELS, VOLUNTEER_CATEGORIES } from "@/lib/volunteer-categories";
import { PERIOD_LABELS, VOLUNTEER_ROLE_PERIODS } from "@/lib/volunteer-roles";
import { RoleCredentialPicker } from "./credential-picker";
import type { RoleActions } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Program the new role belongs to; null = org-wide. Ignored when editing. */
  programId: string | null;
  role?: ManagedRole | null;
  credentials: RoleCredentialOption[];
  isBoard: boolean;
  actions: Pick<RoleActions, "create" | "update">;
}

export function RoleFormModal({ open, onClose, role, ...rest }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={role ? `Edit ${role.name}` : "New volunteer role"}
      description={
        role
          ? "Changes to expected hours apply to new approvals only. Existing assignments keep the hours they were approved with."
          : "A position volunteers can sign up for, with the hours you expect per term."
      }
    >
      <RoleForm key={role?.id ?? "new"} role={role ?? null} onDone={onClose} {...rest} />
    </Modal>
  );
}

function RoleForm({
  role,
  programId,
  credentials,
  isBoard,
  actions,
  onDone,
}: Omit<Props, "open" | "onClose" | "role"> & { role: ManagedRole | null; onDone: () => void }) {
  const toast = useToast();
  const editing = !!role;
  const scopeProgramId = role ? role.programId : programId;
  const orgWide = scopeProgramId === null;
  const locked = (role?.liveCount ?? 0) > 0;
  const { state, pending, onSubmit } = useActionForm((editing ? actions.update : actions.create) as RoleActions["update"]);
  const [grant, setGrant] = useState<string>(role?.grantsProgramRole ?? "");
  const [period, setPeriod] = useState<string>(role?.period ?? (orgWide ? "per_year" : "per_season"));
  const [approval, setApproval] = useState(role?.requiresApproval ?? true);
  const forced = grant !== "";

  useEffect(() => {
    if (!state?.ok) return;
    toast.success(editing ? "Role saved" : "Role created");
    onDone();
  }, [state, toast, onDone, editing]);

  const grantOptions = PROGRAM_ROLES.filter((r) => isBoard || r !== "program_admin" || role?.grantsProgramRole === r);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      {role ? <input type="hidden" name="id" value={role.id} /> : null}
      <input type="hidden" name="programId" value={scopeProgramId ?? ""} />

      <Field label="Role name">
        <Input name="name" required minLength={2} maxLength={80} defaultValue={role?.name} placeholder="Head Baseball Coach" />
      </Field>
      <Field label="Description (optional)">
        <Textarea name="description" rows={3} maxLength={2000} defaultValue={role?.description ?? ""} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Default hours category" hint="Used when volunteers log hours against this role.">
          <Select name="category" defaultValue={role?.category ?? "other"}>
            {VOLUNTEER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Expected hours per term"
          hint={period === "per_season" ? "Per season of this program." : "Per calendar year."}
        >
          <Input
            name="expectedHours"
            required
            inputMode="decimal"
            defaultValue={role ? String(Math.round((role.expectedMinutes / 60) * 100) / 100) : ""}
            placeholder="40"
          />
        </Field>
        <Field label="Term" hint={locked ? "Locked while sign-ups are pending or active." : undefined}>
          {locked ? (
            <>
              <input type="hidden" name="period" value={period} />
              <Select value={period} disabled onChange={() => {}}>
                {VOLUNTEER_ROLE_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            <Select name="period" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {VOLUNTEER_ROLE_PERIODS.map((p) => (
                <option key={p} value={p} disabled={p === "per_season" && orgWide}>
                  {PERIOD_LABELS[p]}
                  {p === "per_season" && orgWide ? " (program roles only)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Slots per term" hint="Leave blank for unlimited.">
          <Input name="slots" inputMode="numeric" defaultValue={role?.slots ?? ""} placeholder="Unlimited" />
        </Field>
      </div>

      {!orgWide ? (
        <Field
          label="Permission this role grants (optional)"
          hint={
            locked
              ? "Locked while sign-ups are pending or active."
              : forced
                ? "Approved volunteers get this access for the term, including rosters and emergency sheets. Approval is required."
                : "Leave as none for roles that need no extra access."
          }
        >
          {locked ? (
            <>
              <input type="hidden" name="grantsProgramRole" value={grant} />
              <Select value={grant} disabled onChange={() => {}}>
                <option value="">No extra permissions</option>
                {PROGRAM_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {PROGRAM_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            <Select
              name="grantsProgramRole"
              value={grant}
              onChange={(e) => {
                setGrant(e.target.value);
                if (e.target.value) setApproval(true);
              }}
            >
              <option value="">No extra permissions</option>
              {grantOptions.map((r) => (
                <option key={r} value={r}>
                  {PROGRAM_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="role-approval" className="mb-0 text-sm font-medium text-charcoal">
            Requires approval
          </Label>
          <p className="text-xs text-stone-400">
            {forced ? "Always on for roles that grant permissions." : "Off: volunteers become active as soon as they sign up."}
          </p>
        </div>
        <Switch
          id="role-approval"
          name="requiresApproval"
          checked={forced ? true : approval}
          disabled={forced}
          onChange={(e) => setApproval(e.target.checked)}
        />
      </div>

      <RoleCredentialPicker options={credentials} defaultSelected={role?.requiredCredentialIds} />

      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : editing ? "Save role" : "Create role"}
        </Button>
      </div>
    </form>
  );
}
