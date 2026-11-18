"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { MotionFormOptions } from "@/lib/dal/board-motions";
import { formatDateTime } from "@/lib/format";
import {
  KIND_LABELS,
  MOTION_KINDS,
  MOTION_THRESHOLDS,
  THRESHOLD_EXPLAINERS,
  THRESHOLD_LABELS,
  type MotionKind,
  type MotionThreshold,
} from "@/lib/validation/board-motions";
import type { FormAction } from "./types";

export interface EditableMotion {
  id: string;
  kind: MotionKind;
  meetingId: string | null;
  title: string;
  body: string;
  threshold: MotionThreshold;
  movedById: string | null;
  secondedById: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  options: MotionFormOptions;
  motion?: EditableMotion | null;
  defaultMeetingId?: string | null;
  create: FormAction;
  update: FormAction;
}

export function MotionFormModal({ open, onClose, motion, ...rest }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={motion ? "Edit motion" : "New motion"}
      description="Drafts are private to the board until you open voting."
    >
      <MotionForm key={motion?.id ?? "new"} motion={motion ?? null} onDone={onClose} {...rest} />
    </Modal>
  );
}

function MotionForm({
  motion,
  options,
  defaultMeetingId,
  create,
  update,
  onDone,
}: Omit<Props, "open" | "onClose" | "motion"> & { motion: EditableMotion | null; onDone: () => void }) {
  const toast = useToast();
  const editing = !!motion;
  const { state, pending, onSubmit } = useActionForm(editing ? update : create);
  const [kind, setKind] = useState<MotionKind>(motion?.kind ?? "in_meeting");
  const [threshold, setThreshold] = useState<MotionThreshold>(motion?.threshold ?? "majority_of_votes_cast");
  const written = kind === "without_meeting";
  const effective: MotionThreshold = written ? "unanimous_of_directors" : threshold;

  useEffect(() => {
    if (!state?.ok) return;
    toast.success(editing ? "Motion saved" : "Draft motion created");
    onDone();
  }, [state, toast, onDone, editing]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      {motion ? <input type="hidden" name="id" value={motion.id} /> : null}
      <Field label="How will the board vote?">
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as MotionKind)}>
          {MOTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>

      {written ? (
        <p className="rounded-xl bg-amber-soft/30 px-3.5 py-2.5 text-xs text-amber-950">
          An action without a meeting passes only if <strong>every</strong> eligible director votes yes. Voting stays open at least 24 hours and each
          director is emailed a link to vote.
        </p>
      ) : (
        <Field label="Meeting">
          <Select name="meetingId" defaultValue={motion?.meetingId ?? defaultMeetingId ?? ""} required>
            <option value="">Choose a meeting…</option>
            {options.meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} · {formatDateTime(m.startsAt)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Title">
        <Input name="title" required minLength={3} maxLength={200} defaultValue={motion?.title} placeholder="Approve the 2027 budget" />
      </Field>
      <Field label="Motion text">
        <Textarea name="body" required rows={6} maxLength={10000} defaultValue={motion?.body} placeholder="Resolved, that the board…" />
      </Field>

      <Field label="Passing threshold" hint={THRESHOLD_EXPLAINERS[effective]}>
        {written ? (
          <>
            <input type="hidden" name="threshold" value="unanimous_of_directors" />
            <Select value="unanimous_of_directors" disabled onChange={() => {}}>
              <option value="unanimous_of_directors">{THRESHOLD_LABELS.unanimous_of_directors}</option>
            </Select>
          </>
        ) : (
          <Select name="threshold" value={threshold} onChange={(e) => setThreshold(e.target.value as MotionThreshold)}>
            {MOTION_THRESHOLDS.map((t) => (
              <option key={t} value={t}>
                {THRESHOLD_LABELS[t]}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Moved by (optional)">
          <Select name="movedBy" defaultValue={motion?.movedById ?? ""}>
            <option value="">—</option>
            {options.seats.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Seconded by (optional)">
          <Select name="secondedBy" defaultValue={motion?.secondedById ?? ""}>
            <option value="">—</option>
            {options.seats.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : editing ? "Save motion" : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
