"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { BuilderTeam, StaffSuggestion } from "@/lib/dal/teams";
import { TEAM_STAFF_ROLES, TEAM_STAFF_ROLE_LABELS, type TeamStaffRoleValue } from "@/lib/validation/teams";
import {
  addStaffAction,
  removeStaffAction,
  suggestStaffAction,
} from "@/app/(portal)/programs/[slug]/seasons/[seasonId]/teams/actions";
import { CredentialReadiness } from "./credential-readiness";
import { useRowAction } from "./use-row-action";

export function TeamStaffModal({ team, path, onClose }: { team: BuilderTeam; path: string; onClose: () => void }) {
  const toast = useToast();
  const { pending: removing, run } = useRowAction();
  const { state, pending, onSubmit } = useActionForm(addStaffAction);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamStaffRoleValue>("assistant_coach");
  const [suggestions, setSuggestions] = useState<StaffSuggestion[]>([]);

  useEffect(() => {
    let live = true;
    const fd = new FormData();
    fd.set("teamId", team.id);
    suggestStaffAction(null, fd).then((r) => {
      if (live && r.ok) setSuggestions(r.data);
    });
    return () => {
      live = false;
    };
    // Re-run when the staff list changes so added people disappear from suggestions.
  }, [team.id, team.staff.length]);

  useEffect(() => {
    if (state?.ok) {
      setEmail("");
      toast.success(`${state.data.name} added`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const remove = (id: string) => {
    const fd = new FormData();
    fd.set("teamStaffId", id);
    fd.set("path", path);
    run(() => removeStaffAction(null, fd), "Staff member removed");
  };

  return (
    <Modal open onClose={onClose} title={`${team.name} staff`} description="Coaches and managers see only this team.">
      <div className="space-y-5">
        {team.staff.length === 0 ? (
          <EmptyState title="No staff yet" description="Add a head coach by email below." />
        ) : (
          <ul className="space-y-2.5">
            {team.staff.map((s) => (
              <li key={s.teamStaffId} className="space-y-1.5 rounded-2xl border border-line-soft bg-white px-3.5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-charcoal">{s.name}</p>
                    <p className="truncate text-xs text-stone-500">{s.email}</p>
                  </div>
                  <Badge tone="info">{TEAM_STAFF_ROLE_LABELS[s.role]}</Badge>
                </div>
                <CredentialReadiness readiness={s.readiness} />
                <div className="flex justify-end">
                  <Button variant="danger" size="sm" disabled={removing} onClick={() => remove(s.teamStaffId)} aria-label={`Remove ${s.name}`}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onSubmit} className="space-y-3 rounded-2xl bg-alabaster/70 p-4">
          <h4 className="text-sm font-bold text-charcoal">Add staff</h4>
          <input type="hidden" name="teamId" value={team.id} />
          <input type="hidden" name="path" value={path} />
          <FormError state={state} />
          <Field label="Email" hint="They must have signed in to GBYS at least once.">
            <Input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="coach@example.com" />
          </Field>
          <Field label="Role">
            <Select name="role" value={role} onChange={(e) => setRole(e.target.value as TeamStaffRoleValue)}>
              {TEAM_STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {TEAM_STAFF_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add to team"}
          </Button>
          {state?.ok && state.data.readiness.items.length > 0 ? (
            <div className="rounded-xl bg-white px-3 py-2.5">
              <p className="mb-1 text-xs font-semibold text-charcoal">{state.data.name} added</p>
              <CredentialReadiness readiness={state.data.readiness} />
              {!state.data.readiness.ready ? (
                <p className="mt-1 text-xs text-stone-500">Added anyway. They can coach once credentials are verified.</p>
              ) : null}
            </div>
          ) : null}
        </form>

        {suggestions.length > 0 ? (
          <div>
            <h4 className="mb-2 text-sm font-bold text-charcoal">Suggestions</h4>
            <ul className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <li key={s.userId}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(s.email);
                      setRole(s.suggestedRole);
                    }}
                    title={`${s.source} · ${s.email}`}
                    className="rounded-full bg-lavender-card px-3 py-1.5 text-xs font-semibold text-indigo-950 hover:bg-periwinkle/40"
                  >
                    {s.name} · {TEAM_STAFF_ROLE_LABELS[s.suggestedRole]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
