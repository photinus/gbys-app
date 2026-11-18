import Link from "next/link";
import { Card } from "@/components/ui";
import type { MyMotionRow } from "@/lib/dal/board-motions";
import { formatDateTime } from "@/lib/format";
import { THRESHOLD_EXPLAINERS, THRESHOLD_LABELS } from "@/lib/validation/board-motions";
import type { ActionResult } from "@/lib/dal/context";
import { MotionKindBadge, MotionStatusBadge } from "./badges";
import { VotePanel } from "./vote-panel";

/** A motion as the voting director sees it (own vote only; closed motions show the saved result). */
export function MotionCard({
  motion: m,
  vote,
  compact,
}: {
  motion: MyMotionRow;
  vote: (motionId: string, choice: string) => Promise<ActionResult<{ motionStatus: string }>>;
  compact?: boolean;
}) {
  const inner = (
    <div className="space-y-3" data-testid="my-motion">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-charcoal break-words">
            {compact ? (
              <Link href={`/board/votes/${m.id}`} className="hover:underline">
                {m.title}
              </Link>
            ) : (
              m.title
            )}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <MotionStatusBadge status={m.status} />
            <MotionKindBadge kind={m.kind} />
            {m.meetingTitle ? <span className="text-xs text-stone-500">{m.meetingTitle}</span> : null}
          </div>
        </div>
        {m.status === "open" && m.closesAt ? <p className="text-xs font-semibold text-stone-600">Voting closes {formatDateTime(m.closesAt)}</p> : null}
      </div>

      {!compact ? (
        <>
          <p className="whitespace-pre-wrap break-words text-sm text-charcoal">{m.body}</p>
          <p className="rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600">
            <strong className="text-charcoal">{THRESHOLD_LABELS[m.threshold]}.</strong> {THRESHOLD_EXPLAINERS[m.threshold]}
          </p>
        </>
      ) : null}

      {m.result ? (
        <p className="text-sm text-stone-600">
          <span className={m.result.passed ? "font-semibold text-emerald-800" : "font-semibold text-rose-800"}>{m.result.reason}</span>
        </p>
      ) : null}

      {m.status === "open" || m.myVote ? (
        <VotePanel motionId={m.id} title={m.title} canVote={m.canVote} cannotVoteReason={m.cannotVoteReason} myVote={m.myVote} vote={vote} />
      ) : compact ? null : (
        <p className="text-sm text-stone-500">You did not vote on this motion.</p>
      )}
      {compact && !m.myVote && m.status !== "open" ? <p className="text-xs text-stone-400">You did not vote{m.closedAt ? ` · closed ${formatDateTime(m.closedAt)}` : ""}.</p> : null}
    </div>
  );
  if (compact) return <div className="border-b border-line-soft pb-4 last:border-0 last:pb-0">{inner}</div>;
  return <Card>{inner}</Card>;
}

