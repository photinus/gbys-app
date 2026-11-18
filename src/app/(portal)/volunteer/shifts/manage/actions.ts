"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { cancelShift, createShift, updateShift } from "@/lib/dal/shifts";
import type { ShiftFormInput } from "@/lib/validation/shifts";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function shiftFromForm(fd: FormData): ShiftFormInput {
  return {
    programId: str(fd, "programId"),
    title: str(fd, "title"),
    description: str(fd, "description"),
    location: str(fd, "location"),
    category: str(fd, "category") as ShiftFormInput["category"],
    startsAt: str(fd, "startsAt"),
    endsAt: str(fd, "endsAt"),
    spotsTotal: str(fd, "spotsTotal") as unknown as number,
  };
}

function revalidateShifts() {
  revalidatePath("/volunteer/shifts");
  revalidatePath("/volunteer/shifts/manage");
  revalidatePath("/volunteer/shifts/[id]", "page");
}

export async function createShiftAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const res = await runAction((ctx) => createShift(ctx, shiftFromForm(formData)));
  if (res.ok) revalidateShifts();
  return res;
}

export async function updateShiftAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult> {
  const res = await runAction((ctx) => updateShift(ctx, str(formData, "shiftId"), shiftFromForm(formData)));
  if (res.ok) revalidateShifts();
  return res;
}

export async function cancelShiftAction(shiftId: string): Promise<ActionResult> {
  const res = await runAction((ctx) => cancelShift(ctx, String(shiftId)));
  if (res.ok) revalidateShifts();
  return res;
}
