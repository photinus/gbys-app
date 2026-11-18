"use client";

import { useEffect } from "react";
import { Button, Field, Input, Modal, Switch, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { addMemberAction, updateMemberAction } from "@/app/(admin)/admin/board/members/actions";
import type { BoardMemberView } from "@/lib/dal/board-members";
import { utcToLaDateInput } from "@/lib/format";
import { SEAT_POSITIONS } from "@/lib/validation/board";

export function MemberFormModal({ open, onClose, member }: { open: boolean; onClose: () => void; member: BoardMemberView | null }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? `Edit seat: ${member.displayName}` : "Add a board seat"}
      description="A seat is one director's term. Link their GBYS sign-in email so they can vote electronically."
    >
      <MemberForm key={member?.id ?? "new"} member={member} onDone={onClose} />
    </Modal>
  );
}

function MemberForm({ member, onDone }: { member: BoardMemberView | null; onDone: () => void }) {
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
      <Field label="Position">
        <Input name="position" required minLength={2} maxLength={80} list="seat-positions" defaultValue={member?.position ?? "Director"} />
      </Field>
      <datalist id="seat-positions">
        {SEAT_POSITIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
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
