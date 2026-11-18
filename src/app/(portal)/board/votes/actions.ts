"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { castVote } from "@/lib/dal/board-motions";

export async function castVoteAction(motionId: string, choice: string): Promise<ActionResult<{ motionStatus: string }>> {
  return runAction(async (ctx) => {
    const r = await castVote(ctx, motionId, choice);
    revalidatePath("/board/votes");
    revalidatePath(`/board/votes/${motionId}`);
    revalidatePath("/admin/board/motions");
    revalidatePath(`/admin/board/motions/${motionId}`);
    return { motionStatus: r.motionStatus };
  });
}
