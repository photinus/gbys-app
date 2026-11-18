"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { logMyHours, withdrawMyHours } from "@/lib/dal/volunteer-hours";
import { toMinutes } from "@/lib/validation/hours";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export async function logMyHoursAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction((ctx) =>
    logMyHours(ctx, {
      programId: str(formData, "programId") || null,
      category: str(formData, "category") as never,
      activityDate: str(formData, "activityDate"),
      durationMinutes: toMinutes(formData.get("hours"), formData.get("minutes")),
      description: str(formData, "description"),
    })
  );
  if (result.ok) {
    revalidatePath("/volunteer/hours");
    revalidatePath("/dashboard");
    revalidatePath("/admin/hours");
  }
  return result;
}

export async function withdrawMyHoursAction(logId: string): Promise<ActionResult> {
  const result = await runAction((ctx) => withdrawMyHours(ctx, logId));
  if (result.ok) {
    revalidatePath("/volunteer/hours");
    revalidatePath("/dashboard");
    revalidatePath("/admin/hours");
  }
  return result;
}
