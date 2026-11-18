"use client";

import { useEffect } from "react";
import { Button, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { endMemberAction } from "@/app/(admin)/admin/board/members/actions";
import type { BoardMemberView } from "@/lib/dal/board-members";
import { utcToLaDateInput } from "@/lib/format";

export function EndSeatModal({ open, onClose, member }: { open: boolean; onClose: () => void; member: BoardMemberView | null }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={member ? `End seat: ${member.displayName}` : "End seat"}
      description="For a resignation or removal. The seat and its history are kept; it just stops counting as seated."
    >
      {member ? <EndForm key={member.id} member={member} onDone={onClose} /> : null}
    </Modal>
  );
}

function EndForm({ member, onDone }: { member: BoardMemberView; onDone: () => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(endMemberAction);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Seat ended");
    onDone();
  }, [state, toast, onDone]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="id" value={member.id} />
      <Field label="Effective date" hint="Today ends the seat right now; another date ends it at the end of that day (Pacific).">
        <Input name="endedAt" type="date" required min={member.termStart} defaultValue={utcToLaDateInput(new Date())} />
      </Field>
      <Field label="Reason">
        <Textarea name="reason" rows={2} required minLength={2} maxLength={500} placeholder="Resigned, moved away, removed by vote..." />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onDone}>
          Keep seat
        </Button>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Ending..." : "End seat"}
        </Button>
      </div>
    </form>
  );
}
