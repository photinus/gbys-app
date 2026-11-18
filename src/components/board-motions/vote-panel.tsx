"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button, Modal, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { CHOICE_LABELS, VOTE_CHOICES, type VoteChoice } from "@/lib/validation/board-motions";
import type { ActionResult } from "@/lib/dal/context";

interface Props {
  motionId: string;
  title: string;
  canVote: boolean;
  cannotVoteReason: string | null;
  myVote: { choice: VoteChoice; castAt: Date | string } | null;
  vote: (motionId: string, choice: string) => Promise<ActionResult<{ motionStatus: string }>>;
}

/** Vote Yes / No / Abstain with a confirm step. A recorded vote is final. */
export function VotePanel({ motionId, title, canVote, cannotVoteReason, myVote, vote }: Props) {
  const toast = useToast();
  const [pick, setPick] = useState<VoteChoice | null>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (myVote) {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-sage/30 px-4 py-3 text-sm text-emerald-950" data-testid="my-vote">
        <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          You voted <strong>{CHOICE_LABELS[myVote.choice]}</strong> on {formatDateTime(myVote.castAt)}. Your vote is final and recorded.
        </span>
      </p>
    );
  }
  if (!canVote) {
    return cannotVoteReason ? <p className="text-sm text-stone-500">{cannotVoteReason}</p> : null;
  }

  const confirm = () => {
    if (!pick) return;
    startTransition(async () => {
      setError(null);
      const r = await vote(motionId, pick);
      if (r.ok) {
        toast.success("Your vote was recorded");
        setPick(null);
      } else setError(r.error);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2.5">
        {VOTE_CHOICES.map((c) => (
          <Button key={c} variant={c === "yes" ? "primary" : "secondary"} onClick={() => { setError(null); setPick(c); }} data-testid={`vote-${c}`}>
            Vote {CHOICE_LABELS[c]}
          </Button>
        ))}
      </div>
      <Modal
        open={!!pick}
        onClose={() => setPick(null)}
        title={pick ? `Confirm your vote: ${CHOICE_LABELS[pick]}` : "Confirm your vote"}
        description={title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPick(null)}>Go back</Button>
            <Button disabled={busy} onClick={confirm} data-testid="confirm-vote">
              {busy ? "Recording..." : pick ? `Record my ${CHOICE_LABELS[pick]} vote` : "Record vote"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-stone-600">
          <p>
            You are voting <strong className="text-charcoal">{pick ? CHOICE_LABELS[pick] : ""}</strong>. <strong className="text-charcoal">Your vote is final and recorded.</strong> It cannot be
            changed or withdrawn.
          </p>
          {error ? <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">{error}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
