"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button, EmptyState, Field, Input, Select, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { grantRoleAction, revokeRoleAction } from "@/app/(admin)/admin/programs/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { ProgramRoleRow } from "@/lib/dal/programs";
import { PROGRAM_ROLES, PROGRAM_ROLE_LABELS } from "@/lib/validation/programs";

export function ProgramRolesPanel({ programId, roles }: { programId: string; roles: ProgramRoleRow[] }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useActionForm(grantRoleAction);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revoking, startRevoke] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Role granted");
      formRef.current?.reset();
    }
  }, [state, toast]);

  const revoke = (roleId: string) => {
    setRevokeError(null);
    startRevoke(async () => {
      const res = await revokeRoleAction(programId, roleId);
      setConfirmId(null);
      if (res.ok) toast.success("Role revoked");
      else setRevokeError(res.error);
    });
  };

  return (
    <div className="space-y-5">
      <form ref={formRef} onSubmit={onSubmit} className="space-y-3 text-sm">
        <input type="hidden" name="programId" value={programId} />
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_200px_auto]">
          <Field label="Person's email" hint="They must have signed in at least once.">
            <Input name="email" type="email" required autoComplete="off" placeholder="coach@example.com" />
          </Field>
          <Field label="Role">
            <Select name="role" defaultValue="head_coach">
              {PROGRAM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {PROGRAM_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={pending} className="mb-[22px] sm:mb-[22px]">
            {pending ? "Granting..." : "Grant role"}
          </Button>
        </div>
        <FormError state={state} />
      </form>

      {revokeError ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {revokeError}
        </p>
      ) : null}

      {roles.length === 0 ? (
        <EmptyState title="No roles yet" description="Grant a role above to add the first coach or admin." />
      ) : (
        <Table className="min-w-[600px]">
          <THead>
            <tr>
              <TH className="pl-2">Person</TH>
              <TH>Role</TH>
              <TH>Season</TH>
              <TH className="pr-2 text-right">Actions</TH>
            </tr>
          </THead>
          <TBody>
            {roles.map((r) => (
              <TR key={r.id} data-testid="role-row">
                <TD className="pl-2">
                  <div className="font-semibold text-charcoal">{r.userName || r.userEmail}</div>
                  {r.userName ? <div className="text-xs text-stone-500">{r.userEmail}</div> : null}
                </TD>
                <TD>
                  <Badge tone={r.role === "program_admin" ? "info" : "neutral"}>{PROGRAM_ROLE_LABELS[r.role]}</Badge>
                </TD>
                <TD className="text-stone-600">{r.seasonName ?? "All seasons"}</TD>
                <TD className="pr-2 text-right">
                  {confirmId === r.id ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Button size="sm" variant="danger" disabled={revoking} onClick={() => revoke(r.id)}>
                        {revoking ? "Revoking..." : "Confirm revoke"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setConfirmId(r.id)}>
                      Revoke
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
