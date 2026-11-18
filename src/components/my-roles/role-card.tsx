"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { OpenRoleRow } from "@/lib/dal/volunteer-role-signups";
import { MAX_SIGNUP_NOTE } from "@/lib/validation/volunteer-role-signups";
import { signUpForRoleAction } from "@/app/(portal)/volunteer/roles/actions";

function slotsText(slotsLeft: number | null): string {
  if (slotsLeft === null) return "Spots open";
  if (slotsLeft === 0) return "Full";
  return `${slotsLeft} ${slotsLeft === 1 ? "spot" : "spots"} left`;
}

export function RoleCard({ role }: { role: OpenRoleRow }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(signUpForRoleAction);
  const firstFree = role.terms.find((t) => !t.myStatus && t.slotsLeft !== 0) ?? role.terms[0];
  const [term, setTerm] = useState(firstFree?.termKey ?? "");
  const selected = role.terms.find((t) => t.termKey === term);
  const missing = role.credentials.filter((c) => !c.ready);
  const termLabelWord = role.period === "per_season" ? "Season" : "Year";

  useEffect(() => {
    if (state?.ok) {
      toast.success(
        state.data.status === "active" ? "You're signed up" : "Request sent",
        state.data.status === "active"
          ? "Find it under My roles."
          : "A program leader will review it. You can follow it under My roles."
      );
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const blocked = !selected || selected.myStatus !== null || selected.slotsLeft === 0;

  return (
    <li className="rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5" data-testid="role-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-base font-bold text-charcoal">{role.name}</h3>
          <p className="text-xs text-stone-500">
            {role.programName ?? "Organization-wide"} · {role.expectationText}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={role.requiresApproval ? "warning" : "success"}>
            {role.requiresApproval ? "Needs approval" : "Join right away"}
          </Badge>
        </div>
      </div>

      {role.description ? <p className="mt-2 whitespace-pre-line text-sm text-stone-600">{role.description}</p> : null}

      {role.grantsAccess ? (
        <p className="mt-3 rounded-xl bg-amber-soft/30 px-3 py-2 text-xs font-medium text-amber-950">
          Includes roster access — needs approval. This role lets you see team rosters and emergency
          contacts, so a program leader checks every request first.
        </p>
      ) : null}

      {role.credentials.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-stone-600">Needs these credentials</p>
          <ul className="mt-1 space-y-0.5">
            {role.credentials.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 text-sm text-charcoal">
                {c.ready ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="You have this" />
                ) : (
                  <X className="h-4 w-4 shrink-0 text-rose-600" aria-label="You still need this" />
                )}
                <span className="min-w-0 break-words">{c.name}</span>
              </li>
            ))}
          </ul>
          {missing.length > 0 ? (
            <p className="mt-1 text-xs text-stone-500">
              You can still {role.requiresApproval ? "request this role" : "sign up"}, but please{" "}
              <Link href="/volunteer/credentials" className="font-semibold text-indigo-700 underline">
                add your missing credentials
              </Link>{" "}
              {role.requiresApproval ? "so it can be approved." : "before you start."}
            </p>
          ) : null}
        </div>
      ) : null}

      {role.terms.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">
          {role.period === "per_season"
            ? "No upcoming or current seasons are open for this role yet. Check back soon."
            : "Sign-ups are not open for this role right now."}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-3" aria-busy={pending}>
          <input type="hidden" name="roleId" value={role.id} />
          <Field label={termLabelWord}>
            <Select name="term" value={term} onChange={(e) => setTerm(e.target.value)} disabled={pending}>
              {role.terms.map((t) => (
                <option key={t.termKey} value={t.termKey}>
                  {t.label} — {t.myStatus ? (t.myStatus === "active" ? "you're in" : "request sent") : slotsText(t.slotsLeft)}
                </option>
              ))}
            </Select>
          </Field>
          {selected?.myStatus ? (
            <p className="text-sm font-medium text-emerald-800">
              {selected.myStatus === "active"
                ? "You're already in this role for that term."
                : "Your request for that term is waiting for approval."}
            </p>
          ) : (
            <>
              <Field label="Note (optional)" hint="Anything the program leader should know.">
                <Textarea name="note" rows={2} maxLength={MAX_SIGNUP_NOTE} disabled={pending} />
              </Field>
              <FormError state={state} />
              <Button type="submit" disabled={pending || blocked} className="w-full sm:w-auto">
                {pending ? "Sending..." : role.requiresApproval ? "Request to join" : "Sign up"}
              </Button>
            </>
          )}
        </form>
      )}
    </li>
  );
}
