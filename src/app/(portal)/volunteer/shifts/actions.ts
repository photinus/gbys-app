"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { isFeatureEnabled } from "@/lib/features";
import {
  addWalkInAndCheckIn,
  cancelMySignup,
  checkInSignup,
  signUpForShift,
  undoCheckIn,
} from "@/lib/dal/shifts";

// Authorization and validation live in the DAL. These wrappers only convert
// results and revalidate the pages that show shift data.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

const SHIFTS_OFF = { ok: false, error: "Shift scheduling is turned off." } as const;

function revalidateShifts() {
  revalidatePath("/volunteer/shifts");
  revalidatePath("/volunteer/shifts/manage");
  revalidatePath("/volunteer/shifts/[id]", "page");
}

export async function signUpAction(shiftId: string): Promise<ActionResult<{ signupId: string }>> {
  if (!isFeatureEnabled("volunteerShifts")) return SHIFTS_OFF;
  const res = await runAction((ctx) => signUpForShift(ctx, String(shiftId)));
  if (res.ok) revalidateShifts();
  return res;
}

export async function cancelSignupAction(signupId: string): Promise<ActionResult> {
  if (!isFeatureEnabled("volunteerShifts")) return SHIFTS_OFF;
  const res = await runAction((ctx) => cancelMySignup(ctx, String(signupId)));
  if (res.ok) revalidateShifts();
  return res;
}

export async function checkInAction(signupId: string): Promise<ActionResult<{ logId: string }>> {
  if (!isFeatureEnabled("volunteerShifts")) return SHIFTS_OFF;
  const res = await runAction((ctx) => checkInSignup(ctx, String(signupId)));
  if (res.ok) revalidateShifts();
  return res;
}

export async function undoCheckInAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult> {
  if (!isFeatureEnabled("volunteerShifts")) return SHIFTS_OFF;
  const res = await runAction((ctx) =>
    undoCheckIn(ctx, str(formData, "signupId"), str(formData, "reason"))
  );
  if (res.ok) revalidateShifts();
  return res;
}

export async function walkInAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult<{ signupId: string }>> {
  if (!isFeatureEnabled("volunteerShifts")) return SHIFTS_OFF;
  const res = await runAction((ctx) =>
    addWalkInAndCheckIn(ctx, str(formData, "shiftId"), str(formData, "email"))
  );
  if (res.ok) revalidateShifts();
  return res;
}
