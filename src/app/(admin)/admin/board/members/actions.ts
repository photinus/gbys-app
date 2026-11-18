"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { addBoardMember, endBoardMember, updateBoardMember, updateBoardPositions, type SeatWarning } from "@/lib/dal/board-members";
import { memberInputFromForm } from "@/lib/validation/board";

// Authorization (board only) and validation live in the DAL.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/admin/board", "layout");
}

export async function addMemberAction(_prev: ActionResult<{ warnings: SeatWarning[] }> | null, fd: FormData): Promise<ActionResult<{ warnings: SeatWarning[] }>> {
  const res = await runAction(async (ctx) => {
    const { warnings } = await addBoardMember(ctx, memberInputFromForm(fd));
    return { warnings };
  });
  if (res.ok) refresh();
  return res;
}

export async function updateMemberAction(_prev: ActionResult<{ warnings: SeatWarning[] }> | null, fd: FormData): Promise<ActionResult<{ warnings: SeatWarning[] }>> {
  const res = await runAction((ctx) => updateBoardMember(ctx, str(fd, "id"), memberInputFromForm(fd)));
  if (res.ok) refresh();
  return res;
}

export async function endMemberAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction((ctx) => endBoardMember(ctx, str(fd, "id"), { endedAt: str(fd, "endedAt"), reason: str(fd, "reason") }));
  if (res.ok) refresh();
  return res;
}

/** Replaces the configured position list (ordered). Existing seats keep their titles. */
export async function savePositionsAction(positions: string[]): Promise<ActionResult<{ positions: string[]; changed: boolean }>> {
  const res = await runAction((ctx) => updateBoardPositions(ctx, Array.isArray(positions) ? positions : []));
  if (res.ok) refresh();
  return res;
}
