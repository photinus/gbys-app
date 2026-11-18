"use server";

import { revalidatePath } from "next/cache";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import { closeMotion, createMotion, openMotion, recordRollCallVote, updateMotion, withdrawMotion } from "@/lib/dal/board-motions";
import { laDateTimeInputToUtc } from "@/lib/format";
import { motionInputFromForm } from "@/lib/validation/board-motions";

// Authorization and validation live in the DAL; these translate FormData and refresh pages.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh(id?: string) {
  revalidatePath("/admin/board/motions");
  if (id) revalidatePath(`/admin/board/motions/${id}`);
  revalidatePath("/admin/board");
  revalidatePath("/board/votes");
}

export async function createMotionAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async (ctx) => {
    const r = await createMotion(ctx, motionInputFromForm(fd));
    refresh();
    return r;
  });
}

export async function updateMotionAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async (ctx) => {
    const id = str(fd, "id");
    await updateMotion(ctx, id, motionInputFromForm(fd));
    refresh(id);
    return { id };
  });
}

export async function openMotionAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ eligible: number; emailed: number }>> {
  return runAction(async (ctx) => {
    const id = str(fd, "id");
    const raw = str(fd, "closesAt");
    if (raw && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) throw new DalError("INVALID", "Enter a valid closing date and time.");
    const r = await openMotion(ctx, id, { closesAt: raw ? laDateTimeInputToUtc(raw) : null });
    refresh(id);
    return r;
  });
}

export async function closeMotionAction(id: string): Promise<ActionResult<{ passed: boolean; reason: string }>> {
  return runAction(async (ctx) => {
    const r = await closeMotion(ctx, id);
    refresh(id);
    return { passed: r.status === "passed", reason: r.result.reason };
  });
}

export async function withdrawMotionAction(id: string, reason?: string): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await withdrawMotion(ctx, id, reason ?? null);
    refresh(id);
  });
}

export async function rollCallAction(motionId: string, boardMemberId: string, choice: string): Promise<ActionResult> {
  return runAction(async (ctx) => {
    await recordRollCallVote(ctx, motionId, boardMemberId, choice);
    refresh(motionId);
  });
}
