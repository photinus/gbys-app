"use client";

import { useState, useTransition } from "react";
import { Button, Modal, useToast } from "@/components/ui";
import type { MotionSeatRow } from "@/lib/dal/board-motions";
import { CHOICE_LABELS, VOTE_CHOICES, type VoteChoice } from "@/lib/validation/board-motions";
import type { MotionActions } from "./types";

/** Secretary records voice votes for directors marked present or remote. Each vote is final. */
export function RollCallRecorder({ motionId, seats, rollCall }: { motionId: string; seats: MotionSeatRow[]; rollCall: MotionActions["rollCall"] }) {
  const toast = useToast();
  const [pick, setPick] = useState<{ seat: MotionSeatRow; choice: VoteChoice } | null>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const present = seats.filter((s) => s.attendance === "present" || s.attendance === "remote");

  const confirm = () => {
    if (!pick) return;
    startTransition(async () => {
      setError(null);
      const r = await rollCall(motionId, pick.seat.boardMemberId, pick.choice);
      if (r.ok) {
        toast.success(`Recorded ${CHOICE_LABELS[pick.choice]} for ${pick.seat.displayName}`);
        setPick(null);
      } else setError(r.error);
    });
  };

  if (present.length === 0) {
    return <p className="text-sm text-stone-500">No directors are recorded as present or remote for this meeting, so no roll-call votes can be recorded.</p>;
  }

  return (
    <div className="space-y-3" data-testid="roll-call">
      {error && !pick ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">{error}</p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {present.map((s) => (
          <li key={s.boardMemberId} className="min-w-0 rounded-2xl border border-line bg-white p-3.5" data-testid="roll-call-seat">
            <div className="truncate text-sm font-semibold text-charcoal">{s.displayName}</div>
            <div className="mb-2.5 text-xs text-stone-500">{s.position} · {s.attendance === "remote" ? "Remote" : "Present"}</div>
            {s.vote ? (
              <p className="text-sm text-charcoal">
                Voted <strong>{CHOICE_LABELS[s.vote.choice]}</strong>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {VOTE_CHOICES.map((c) => (
                  <Button key={c} size="sm" variant="secondary" onClick={() => { setError(null); setPick({ seat: s, choice: c }); }}>
                    {CHOICE_LABELS[c]}
                  </Button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <Modal
        open={!!pick}
        onClose={() => setPick(null)}
        title="Record this vote?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPick(null)}>Cancel</Button>
            <Button disabled={busy} onClick={confirm}>{busy ? "Recording..." : "Record vote"}</Button>
          </>
        }
      >
        {pick ? (
          <div className="space-y-3 text-sm text-stone-600">
            <p>
              Record <strong className="text-charcoal">{CHOICE_LABELS[pick.choice]}</strong> for <strong className="text-charcoal">{pick.seat.displayName}</strong>. This is
              final and is logged as recorded by you.
            </p>
            {error ? <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">{error}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
