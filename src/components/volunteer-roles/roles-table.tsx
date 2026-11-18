"use client";

import { useState, useTransition } from "react";
import { Badge, Button, EmptyState, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ui";
import type { ManagedRole } from "@/lib/dal/volunteer-roles";
import { PROGRAM_ROLE_LABELS } from "@/lib/validation/programs";
import { CATEGORY_LABELS } from "@/lib/volunteer-categories";
import { PERIOD_LABELS } from "@/lib/volunteer-roles";
import { formatHours } from "@/lib/format";
import type { RoleActions } from "./types";

export function RolesTable({
  roles,
  showProgram,
  onEdit,
  onAssign,
  actions,
}: {
  roles: ManagedRole[];
  showProgram?: boolean;
  onEdit: (r: ManagedRole) => void;
  onAssign: (r: ManagedRole) => void;
  actions: Pick<RoleActions, "archive" | "restore">;
}) {
  const toast = useToast();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (r: ManagedRole) =>
    startTransition(async () => {
      setError(null);
      const res = await (r.isActive ? actions.archive(r.id) : actions.restore(r.id));
      if (res.ok) toast.success(r.isActive ? "Role archived" : "Role restored");
      else setError(res.error);
    });

  if (roles.length === 0) {
    return <EmptyState title="No volunteer roles yet" description="Create a role so volunteers can sign up and you can track the hours you expect." />;
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
      <Table className="min-w-[880px]">
        <THead>
          <tr>
            <TH className="pl-2">Role</TH>
            <TH>Expected</TH>
            <TH>Slots</TH>
            <TH>Approval</TH>
            <TH>Grants</TH>
            <TH>Status</TH>
            <TH className="pr-2 text-right">Actions</TH>
          </tr>
        </THead>
        <TBody>
          {roles.map((r) => (
            <TR key={r.id} data-testid="role-row" className={r.isActive ? undefined : "opacity-60"}>
              <TD className="pl-2">
                <div className="font-semibold text-charcoal">{r.name}</div>
                <div className="text-xs text-stone-500">
                  {showProgram ? `${r.programName ?? "Org-wide"} · ` : ""}
                  {CATEGORY_LABELS[r.category]}
                </div>
                {r.requiredCredentialNames.length ? (
                  <div className="mt-0.5 text-xs text-stone-400">Requires: {r.requiredCredentialNames.join(", ")}</div>
                ) : null}
              </TD>
              <TD className="whitespace-nowrap text-charcoal">
                {formatHours(r.expectedMinutes)}
                <div className="text-xs text-stone-500">{PERIOD_LABELS[r.period].toLowerCase()}</div>
              </TD>
              <TD className="whitespace-nowrap text-charcoal" title="Most live sign-ups in any current term, out of the slots available per term">
                {r.slotsUsed}
                {r.slots === null ? " (unlimited)" : ` of ${r.slots}`}
                {r.pendingCount > 0 ? <div className="text-xs text-amber-800">{r.pendingCount} pending</div> : null}
              </TD>
              <TD>
                <Badge tone={r.requiresApproval ? "info" : "neutral"}>{r.requiresApproval ? "Approval" : "Open"}</Badge>
              </TD>
              <TD>
                {r.grantsProgramRole ? (
                  <Badge tone="warning">{PROGRAM_ROLE_LABELS[r.grantsProgramRole]} access</Badge>
                ) : (
                  <span className="text-xs text-stone-400">None</span>
                )}
              </TD>
              <TD>
                <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "Active" : "Archived"}</Badge>
              </TD>
              <TD className="pr-2 text-right">
                {r.canManage ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {r.isActive ? (
                      <Button size="sm" variant="secondary" onClick={() => onAssign(r)}>
                        Assign
                      </Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onClick={() => onEdit(r)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(r)}>
                      {r.isActive ? "Archive" : "Restore"}
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-stone-400">View only</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
