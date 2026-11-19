"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { rotateCalendarToken } from "@/lib/dal/teams";

export async function rotateCalendarTokenAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const teamId = String(fd.get("teamId") ?? "");
  const res = await runAction((ctx) => rotateCalendarToken(ctx, teamId));
  if (res.ok) {
    const path = String(fd.get("path") ?? "");
    if (/^\/programs\/[a-z0-9-]+\/teams\/[0-9a-f-]{36}$/i.test(path)) {
      revalidatePath(path);
      revalidatePath(`${path}/schedule`);
    }
  }
  return res;
}
