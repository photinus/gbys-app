"use client";

import { Check, Undo2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { checkInAction, undoCheckInAction, walkInAction } from "@/app/(portal)/volunteer/shifts/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { RosterEntry, RosterShift } from "@/lib/dal/shifts";
import { formatHours, formatTime } from "@/lib/format";

/** Tablet-friendly kiosk roster: large tap targets, one primary action per volunteer. */
export function RosterBoard({ shift, entries }: { shift: RosterShift; entries: RosterEntry[] }) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<RosterEntry | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const refresh = () => startTransition(() => router.refresh());

  const checkIn = async (e: RosterEntry) => {
    setBusyId(e.signupId);
    const res = await checkInAction(e.signupId);
    setBusyId(null);
    if (res.ok) {
      toast.success(`${e.name} checked in`);
      refresh();
    } else toast.error(res.error);
  };

  const checkedIn = entries.filter((e) => e.checkedInAt).length;
  const canAct = !shift.cancelledAt && shift.checkInOpen;

  return (
    <div className="space-y-5">
      {shift.cancelledAt ? (
        <p className="rounded-xl bg-coral/25 px-4 py-3 text-sm font-medium text-rose-900">This shift was cancelled.</p>
      ) : !shift.checkInOpen ? (
        <p className="rounded-xl bg-amber-soft/40 px-4 py-3 text-sm font-medium text-amber-950">
          {new Date() < shift.checkInOpensAt
            ? `Check-in opens at ${formatTime(shift.checkInOpensAt)} (2 hours before the start).`
            : "Check-in is closed (more than 7 days after the shift)."}
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="Roster"
          description={`${checkedIn} of ${entries.length} checked in · ${shift.spotsTotal} ${shift.spotsTotal === 1 ? "spot" : "spots"}`}
          action={
            <Button size="sm" onClick={() => setWalkInOpen(true)} disabled={!canAct}>
              <UserPlus className="h-4 w-4" /> Add walk-in
            </Button>
          }
        />
        {entries.length === 0 ? (
          <EmptyState title="No one is signed up" description="Add a walk-in to check someone in." />
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => (
              <li
                key={e.signupId}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-alabaster/50 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-charcoal">{e.name}</p>
                  <p className="truncate text-xs text-stone-500">{e.email}</p>
                  {e.checkedInAt ? (
                    <p className="mt-1 text-xs text-stone-500">
                      Checked in {formatTime(e.checkedInAt)}
                      {e.checkedInByName ? ` by ${e.checkedInByName}` : ""}
                      {e.loggedMinutes ? ` · ${formatHours(e.loggedMinutes)} logged` : ""}
                    </p>
                  ) : null}
                </div>
                {e.checkedInAt ? (
                  <div className="flex items-center gap-3">
                    <Badge tone="success" className="px-4 py-2 text-sm">
                      <Check className="mr-1 h-4 w-4" /> Checked in
                    </Badge>
                    <Button variant="secondary" size="sm" onClick={() => setUndoTarget(e)}>
                      <Undo2 className="h-3.5 w-3.5" /> Undo
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="min-h-14 min-w-44 px-8 py-4 text-lg"
                    disabled={!canAct || busyId === e.signupId}
                    onClick={() => checkIn(e)}
                  >
                    {busyId === e.signupId ? "Checking in..." : "Check in"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={undoTarget !== null}
        onClose={() => setUndoTarget(null)}
        title="Undo check-in"
        description={undoTarget ? `${undoTarget.name}'s ledger entry will be voided and kept for audit.` : undefined}
      >
        {undoTarget ? (
          <UndoForm
            signupId={undoTarget.signupId}
            onDone={(ok) => {
              setUndoTarget(null);
              if (ok) refresh();
            }}
          />
        ) : null}
      </Modal>
      <Modal
        open={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        title="Add a walk-in"
        description="They need an account already. This works even when the shift is full."
      >
        <WalkInForm
          shiftId={shift.id}
          onDone={(ok) => {
            setWalkInOpen(false);
            if (ok) refresh();
          }}
        />
      </Modal>
    </div>
  );
}

function UndoForm({ signupId, onDone }: { signupId: string; onDone: (ok: boolean) => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(undoCheckInAction);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Check-in undone");
    onDone(true);
  }, [state, toast, onDone]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="signupId" value={signupId} />
      <Field label="Reason" hint="Required. Recorded in the audit log.">
        <Textarea name="reason" rows={3} required minLength={3} maxLength={500} placeholder="Checked in the wrong person" />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Keep check-in
        </Button>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Undoing..." : "Undo check-in"}
        </Button>
      </div>
    </form>
  );
}

function WalkInForm({ shiftId, onDone }: { shiftId: string; onDone: (ok: boolean) => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(walkInAction);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Walk-in checked in");
    onDone(true);
  }, [state, toast, onDone]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="shiftId" value={shiftId} />
      <Field label="Volunteer's email">
        <Input name="email" type="email" required autoComplete="off" placeholder="name@example.com" />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Checking in..." : "Add and check in"}
        </Button>
      </div>
    </form>
  );
}
