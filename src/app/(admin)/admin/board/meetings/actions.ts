"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  approveMinutes,
  cancelMeeting,
  createMeeting,
  markMeetingHeld,
  recordAttendance,
  saveMinutesDraft,
  setMinutesPublic,
  updateMeeting,
} from "@/lib/dal/board-meetings";
import { ATTENDANCE_STATUSES, meetingInputFromForm, type AttendanceEntry } from "@/lib/validation/board";

// Authorization (board only) and validation live in the DAL.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/admin/board", "layout");
  revalidatePath("/board", "layout");
}

export async function createMeetingAction(_prev: ActionResult<{ id: string }> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction((ctx) => createMeeting(ctx, meetingInputFromForm(fd)));
  if (res.ok) refresh();
  return res;
}

export async function updateMeetingAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction((ctx) => updateMeeting(ctx, str(fd, "id"), meetingInputFromForm(fd)));
  if (res.ok) refresh();
  return res;
}

export async function cancelMeetingAction(id: string, reason: string): Promise<ActionResult> {
  const res = await runAction((ctx) => cancelMeeting(ctx, id, { reason }));
  if (res.ok) refresh();
  return res;
}

export async function markHeldAction(id: string): Promise<ActionResult> {
  const res = await runAction((ctx) => markMeetingHeld(ctx, id));
  if (res.ok) refresh();
  return res;
}

/** Form fields are named `status_<boardMemberId>`; blank = leave untouched. */
export async function recordAttendanceAction(_prev: ActionResult<{ recorded: number }> | null, fd: FormData): Promise<ActionResult<{ recorded: number }>> {
  const entries: AttendanceEntry[] = [];
  for (const [name, value] of fd.entries()) {
    if (!name.startsWith("status_") || typeof value !== "string" || value === "") continue;
    entries.push({ boardMemberId: name.slice("status_".length), status: value as (typeof ATTENDANCE_STATUSES)[number] });
  }
  const res = await runAction((ctx) => recordAttendance(ctx, str(fd, "meetingId"), entries));
  if (res.ok) refresh();
  return res;
}

export async function saveMinutesAction(meetingId: string, body: string): Promise<ActionResult<{ id: string; version: number; created: boolean }>> {
  const res = await runAction((ctx) => saveMinutesDraft(ctx, meetingId, body));
  if (res.ok) refresh();
  return res;
}

export async function approveMinutesAction(minutesId: string): Promise<ActionResult<{ version: number }>> {
  const res = await runAction((ctx) => approveMinutes(ctx, minutesId));
  if (res.ok) refresh();
  return res;
}

export async function setMinutesPublicAction(minutesId: string, isPublic: boolean): Promise<ActionResult> {
  const res = await runAction((ctx) => setMinutesPublic(ctx, minutesId, isPublic));
  if (res.ok) refresh();
  return res;
}
