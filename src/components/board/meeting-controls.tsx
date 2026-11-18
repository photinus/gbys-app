"use client";

import { useState, useTransition } from "react";
import { Button, Field, Modal, Textarea, useToast } from "@/components/ui";
import { cancelMeetingAction, markHeldAction } from "@/app/(admin)/admin/board/meetings/actions";
import { MeetingFormModal, type EditableMeeting } from "./meeting-form-modal";

export function MeetingControls({
  meeting,
  status,
  canMarkHeld,
}: {
  meeting: EditableMeeting;
  status: "scheduled" | "held" | "cancelled";
  canMarkHeld: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const held = () =>
    start(async () => {
      setError(null);
      const res = await markHeldAction(meeting.id);
      if (res.ok) toast.success("Marked as held");
      else setError(res.error);
    });
  const cancel = () =>
    start(async () => {
      setError(null);
      const res = await cancelMeetingAction(meeting.id, reason);
      if (res.ok) {
        toast.success("Meeting cancelled");
        setCancelling(false);
      } else setError(res.error);
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status !== "cancelled" ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
        {status === "scheduled" && canMarkHeld ? (
          <Button size="sm" onClick={held} disabled={pending}>
            Mark as held
          </Button>
        ) : null}
        {status === "scheduled" ? (
          <Button variant="danger" size="sm" onClick={() => setCancelling(true)}>
            Cancel meeting
          </Button>
        ) : null}
      </div>
      {error && !cancelling ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
      <MeetingFormModal open={editing} onClose={() => setEditing(false)} meeting={meeting} />
      <Modal open={cancelling} onClose={() => setCancelling(false)} title="Cancel this meeting?" description="It stays on record as cancelled. Public meetings show as cancelled to members.">
        <div className="space-y-4 text-sm">
          <Field label="Reason (optional)">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} />
          </Field>
          {error ? (
            <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Keep meeting
            </Button>
            <Button variant="danger" onClick={cancel} disabled={pending}>
              {pending ? "Cancelling..." : "Cancel meeting"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
