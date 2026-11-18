import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { MotionCard } from "@/components/board-motions/motion-card";
import { DalError, requireSession } from "@/lib/dal/context";
import { listMyMotions } from "@/lib/dal/board-motions";
import { castVoteAction } from "./actions";

export const metadata: Metadata = { title: "Board votes" };

export default async function BoardVotesPage() {
  const ctx = await requireSession("/board/votes");
  let motions;
  try {
    motions = await listMyMotions(ctx);
  } catch (e) {
    if (e instanceof DalError) notFound(); // not a seated director with a linked account
    throw e;
  }
  const open = motions.filter((m) => m.status === "open");
  const closed = motions.filter((m) => m.status !== "open");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Board votes</h1>
        <p className="mt-1 text-sm text-stone-500">
          Motions awaiting your vote as a director. Every vote is final and recorded.{" "}
          <Link href="/board" className="font-semibold text-charcoal underline underline-offset-2">
            Board meetings
          </Link>
        </p>
      </div>

      <section aria-labelledby="open-motions" className="space-y-4">
        <h2 id="open-motions" className="text-lg font-bold text-charcoal">Open for voting</h2>
        {open.length === 0 ? (
          <EmptyState title="Nothing to vote on" description="When the board opens a motion that needs your vote, it will appear here." />
        ) : (
          open.map((m) => <MotionCard key={m.id} motion={m} vote={castVoteAction} />)
        )}
      </section>

      {closed.length > 0 ? (
        <section aria-labelledby="closed-motions" className="space-y-4">
          <h2 id="closed-motions" className="text-lg font-bold text-charcoal">Recent results</h2>
          <Card className="space-y-4">
            {closed.map((m) => (
              <MotionCard key={m.id} motion={m} vote={castVoteAction} compact />
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  );
}
