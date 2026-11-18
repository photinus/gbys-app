"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { updateSeason } from "@/lib/dal/seasons";
import { seasonInputFromForm } from "@/lib/validation/seasons";

export async function updateSeasonAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult> {
  const seasonId = String(formData.get("seasonId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const res = await runAction(async (ctx) => {
    await updateSeason(ctx, seasonId, seasonInputFromForm(formData));
  });
  if (res.ok) {
    revalidatePath("/programs");
    revalidatePath(`/programs/${slug}`);
    revalidatePath(`/programs/${slug}/seasons/${seasonId}`);
  }
  return res;
}
