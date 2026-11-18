"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Field, Input, Modal, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { MotionFormOptions } from "@/lib/dal/board-motions";
import type { MotionKind, MotionStatus } from "@/lib/validation/board-motions";
import { MotionFormModal, type EditableMotion } from "./motion-form-modal";
import type { MotionActions } from "./types";

interface Props {
  id: string;
  title: string;
  kind: MotionKind;
  status: MotionStatus;
  votesCast: number;
  editable: EditableMotion;
  options: MotionFormOptions;
  /** datetime-local values (Pacific) computed on the server. */
  defaultClosesAt: string;
  minClosesAt: string;
  actions: MotionActions;
}

export function MotionControls({ id, title, kind, status, votesCast, editable, options, defaultClosesAt, minClosesAt, actions }: Props) {
  const toast = useToast();
  const [modal, setModal] = useState<null | "edit" | "open" | "close" | "withdraw">(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = () => setModal(null);

  const run = (fn: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string }>, success: (d: unknown) => string) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) {
        toast.success(success(r.data));
        done();
      } else setError(r.error);
    });

  if (status !== "draft" && status !== "open") return null;
  const canWithdraw = votesCast === 0;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="motion-controls">
      {status === "draft" ? (
        <>
          <Button onClick={() => { setError(null); setModal("open"); }} data-testid="open-motion">Open voting</Button>
          <Button variant="secondary" onClick={() => setModal("edit")}>Edit</Button>
        </>
      ) : (
        <Button onClick={() => { setError(null); setModal("close"); }} data-testid="close-motion">Close voting</Button>
      )}
      {canWithdraw ? (
        <Button variant="danger" onClick={() => { setError(null); setModal("withdraw"); }}>Withdraw</Button>
      ) : (
        <span className="text-xs text-stone-500">Withdrawing is not possible once votes are recorded.</span>
      )}

      <MotionFormModal open={modal === "edit"} onClose={done} options={options} motion={editable} create={actions.create} update={actions.update} />

      <Modal
        open={modal === "open"}
        onClose={done}
        title="Open voting"
        description={
          kind === "in_meeting"
            ? "Quorum is checked against the recorded attendance for the meeting."
            : "Every eligible director is emailed a link to vote."
        }
      >
        <OpenForm id={id} kind={kind} defaultClosesAt={defaultClosesAt} minClosesAt={minClosesAt} open={actions.open} onDone={done} />
      </Modal>

      <Modal
        open={modal === "close"}
        onClose={done}
        title="Close voting?"
        description={title}
        footer={
          <>
            <Button variant="ghost" onClick={done}>Keep open</Button>
            <Button disabled={busy} onClick={() => run(() => actions.close(id), (d) => ((d as { passed: boolean }).passed ? "Motion passed" : "Motion failed"))}>
              {busy ? "Closing..." : "Close and record result"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-stone-600">
          <p>The result is calculated from the votes recorded now and saved permanently. Directors who have not voted are not counted as votes cast{kind === "in_meeting" ? ", and quorum is checked again" : ", and an action without a meeting fails unless every eligible director voted yes"}.</p>
          {error ? <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">{error}</p> : null}
        </div>
      </Modal>

      <Modal
        open={modal === "withdraw"}
        onClose={done}
        title="Withdraw this motion?"
        description={title}
        footer={
          <>
            <Button variant="ghost" onClick={done}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => run(() => actions.withdraw(id), () => "Motion withdrawn")}>
              {busy ? "Withdrawing..." : "Withdraw motion"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-stone-600">
          <p>A withdrawn motion cannot be reopened. This is only possible while no votes have been recorded.</p>
          {error ? <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">{error}</p> : null}
        </div>
      </Modal>
    </div>
  );
}

function OpenForm({
  id,
  kind,
  defaultClosesAt,
  minClosesAt,
  open,
  onDone,
}: {
  id: string;
  kind: MotionKind;
  defaultClosesAt: string;
  minClosesAt: string;
  open: MotionActions["open"];
  onDone: () => void;
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(open);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Voting is open");
    onDone();
  }, [state, toast, onDone]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="id" value={id} />
      <p className="text-stone-600">
        The directors seated right now become the eligible voters. Anyone added or removed later does not change who can vote on this motion.
      </p>
      {kind === "without_meeting" ? (
        <Field label="Voting closes (Pacific time)" hint="At least 24 hours from now. Missing votes at this time mean the motion fails.">
          <Input type="datetime-local" name="closesAt" required defaultValue={defaultClosesAt} min={minClosesAt} />
        </Field>
      ) : null}
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Opening..." : "Open voting"}</Button>
      </div>
    </form>
  );
}
