import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MotionCard } from "@/components/board-motions/motion-card";
import { DalError, requireSession } from "@/lib/dal/context";
import { getMyMotion } from "@/lib/dal/board-motions";
import { castVoteAction } from "../actions";

export const metadata: Metadata = { title: "Board vote" };

export default async function BoardVotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/board/votes/${id}`);
  let motion;
  try {
    motion = await getMyMotion(ctx, id);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  return (
    <div className="space-y-6">
      <Link href="/board/votes" className="text-xs font-semibold text-stone-500 hover:text-charcoal">
        ← All votes
      </Link>
      <MotionCard motion={motion} vote={castVoteAction} />
    </div>
  );
}
