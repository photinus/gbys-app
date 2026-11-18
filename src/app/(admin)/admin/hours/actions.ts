"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { approveHours, logHoursForVolunteer, rejectHours } from "@/lib/dal/volunteer-hours";
import { toMinutes } from "@/lib/validation/hours";

// Board-only authorization is enforced inside the DAL.

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function revalidateHours() {
  revalidatePath("/admin/hours");
  revalidatePath("/volunteer/hours");
  revalidatePath("/dashboard");
}

export async function approveHoursAction(logId: string): Promise<ActionResult> {
  const result = await runAction((ctx) => approveHours(ctx, logId));
  if (result.ok) revalidateHours();
  return result;
}

export async function rejectHoursAction(logId: string, reason: string): Promise<ActionResult> {
  const result = await runAction((ctx) => rejectHours(ctx, logId, reason));
  if (result.ok) revalidateHours();
  return result;
}

export async function logHoursForVolunteerAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const result = await runAction((ctx) =>
    logHoursForVolunteer(ctx, {
      email: str(formData, "email"),
      programId: str(formData, "programId") || null,
      category: str(formData, "category") as never,
      activityDate: str(formData, "activityDate"),
      durationMinutes: toMinutes(formData.get("hours"), formData.get("minutes")),
      description: str(formData, "description"),
    })
  );
  if (result.ok) revalidateHours();
  return result;
}
