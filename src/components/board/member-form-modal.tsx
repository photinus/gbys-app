"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Select, Switch, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { addMemberAction, updateMemberAction } from "@/app/(admin)/admin/board/members/actions";
import type { BoardMemberView } from "@/lib/dal/board-members";
import { utcToLaDateInput } from "@/lib/format";
import { samePosition } from "@/lib/validation/board";

interface FormProps {
  member: BoardMemberView | null;
  positions: string[];
  members: BoardMemberView[];
}

export function MemberFormModal({ open, onClose, member, positions, members }: { open: boolean; onClose: () => void } & FormProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? `Edit seat: ${member.displayName}` : "Add a board seat"}
      description="A seat is one director's term. Link their GBYS sign-in email so they can vote electronically."
    >
      <MemberForm key={member?.id ?? "new"} member={member} positions={positions} members={members} onDone={onClose} />
    </Modal>
  );
}

const OTHER = "__other__";

function PositionField({ member, positions, members }: FormProps) {
  const listed = member ? positions.find((p) => samePosition(p, member.position)) : undefined;
  const [choice, setChoice] = useState<string>(member ? (listed ?? OTHER) : (positions[positions.length - 1] ?? ""));
  const [other, setOther] = useState(member && !listed ? member.position : "");
  const value = choice === OTHER ? other.trim() : choice;
  const last = positions[positions.length - 1];
  const dup =
    value && !(last && samePosition(last, value))
      ? members.find((m) => m.id !== member?.id && m.status === "current" && samePosition(m.position, value))
      : undefined;
  return (
    <div className="space-y-2">
      <Field label="Position" hint="Manage the list with the Manage positions button.">
        <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Position" required>
          {positions.length === 0 ? <option value="">Choose a position...</option> : null}
          {positions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value={OTHER}>Other...</option>
        </Select>
      </Field>
      {choice === OTHER ? (
        <Field label="Other title" hint="A one-off title for this seat (2 to 80 characters).">
          <Input value={other} onChange={(e) => setOther(e.target.value)} required minLength={2} maxLength={80} aria-label="Other position title" />
        </Field>
      ) : null}
      <input type="hidden" name="position" value={value} />
      {dup ? (
        <p role="status" data-testid="dup-position" className="rounded-xl bg-amber-50 px-3.5 py-2 text-xs text-amber-900">
          {dup.displayName} already holds {dup.position}. You can still save this seat.
        </p>
      ) : null}
    </div>
  );
}

function MemberForm({ member, positions, members, onDone }: FormProps & { onDone: () => void }) {
  const toast = useToast();
  const editing = !!member;
  const { state, pending, onSubmit } = useActionForm(editing ? updateMemberAction : addMemberAction);
  const locked = !!member && (member.status === "ended" || member.hasHistory);

  useEffect(() => {
    if (!state?.ok) return;
    toast.success(editing ? "Seat saved" : "Seat added");
    const first = state.data.warnings[0];
    if (first) toast.error("Heads up", first.message);
    onDone();
  }, [state, toast, onDone, editing]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      {member ? <input type="hidden" name="id" value={member.id} /> : null}
      <Field label="Director's name">
        <Input name="displayName" required minLength={2} maxLength={100} defaultValue={member?.displayName} placeholder="Jordan Rivera" />
      </Field>
      <Field label="Sign-in email (optional)" hint="Links this seat to their account. Without it they can't vote electronically.">
        <Input name="email" type="email" maxLength={254} defaultValue={member?.account?.email ?? ""} placeholder="jordan@example.com" disabled={locked && !!member?.userId} />
      </Field>
      {locked && member?.userId ? <input type="hidden" name="email" value={member.account?.email ?? ""} /> : null}
      <PositionField member={member} positions={positions} members={members} />
      <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-alabaster/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-charcoal">Voting director</p>
          <p className="text-xs text-stone-500">Counts toward quorum and can vote on motions.</p>
        </div>
        <Switch name="isVotingDirector" defaultChecked={member?.isVotingDirector ?? true} disabled={locked} aria-label="Voting director" />
      </div>
      {locked ? <input type="hidden" name="isVotingDirector" value={member?.isVotingDirector ? "true" : "false"} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Term starts">
          <Input name="termStart" type="date" required defaultValue={member?.termStart ?? utcToLaDateInput(new Date())} readOnly={locked} />
        </Field>
        <Field label="Term ends (optional)" hint="Leave blank for an open-ended term.">
          <Input name="termEnd" type="date" defaultValue={member?.termEnd ?? ""} readOnly={member?.status === "ended"} />
        </Field>
        <Field label="Elected on (optional)">
          <Input name="electedOn" type="date" defaultValue={member?.electedOn ?? ""} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Textarea name="notes" rows={2} maxLength={2000} defaultValue={member?.notes ?? ""} />
      </Field>
      {locked ? (
        <p className="text-xs text-stone-500">
          {member?.status === "ended"
            ? "This seat has ended, so its account, voting right and term are fixed."
            : "This seat already has attendance or votes recorded, so its account, voting right and start date are fixed."}
        </p>
      ) : null}
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : editing ? "Save seat" : "Add seat"}
        </Button>
      </div>
    </form>
  );
}
