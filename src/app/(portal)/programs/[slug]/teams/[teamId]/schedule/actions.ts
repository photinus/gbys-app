"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { cancelTeamEvent, createTeamEvent, updateTeamEvent } from "@/lib/dal/team-schedule";
import { teamEventInputFromForm } from "@/lib/validation/team-schedule";
import type { EventBookingStatus } from "@/lib/dal/team-schedule";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export interface CreateEventOutcome {
  count: number;
  bookingStatus: "none" | "requested" | "approved";
  isSeries: boolean;
  skipped: { date: string; reason: string }[];
}

function revalidate(slug: string, teamId: string) {
  revalidatePath(`/programs/${slug}/teams/${teamId}/schedule`);
  revalidatePath("/schedule");
  revalidatePath("/teams");
}

export async function createEventAction(_prev: ActionResult<CreateEventOutcome> | null, fd: FormData): Promise<ActionResult<CreateEventOutcome>> {
  const teamId = str(fd, "teamId");
  const slug = str(fd, "slug");
  const res = await runAction(async (ctx) => {
    const r = await createTeamEvent(ctx, teamId, teamEventInputFromForm(fd));
    return { count: r.created.length, bookingStatus: r.bookingStatus, isSeries: r.seriesId !== null, skipped: r.skipped };
  });
  if (res.ok) revalidate(slug, teamId);
  return res;
}

export async function updateEventAction(
  _prev: ActionResult<{ bookingStatus: EventBookingStatus; rebooked: boolean }> | null,
  fd: FormData
): Promise<ActionResult<{ bookingStatus: EventBookingStatus; rebooked: boolean }>> {
  const teamId = str(fd, "teamId");
  const slug = str(fd, "slug");
  const res = await runAction(async (ctx) => {
    const r = await updateTeamEvent(ctx, str(fd, "eventId"), teamEventInputFromForm(fd));
    return { bookingStatus: r.bookingStatus, rebooked: r.rebooked };
  });
  if (res.ok) revalidate(slug, teamId);
  return res;
}

export async function cancelEventAction(_prev: ActionResult<{ cancelled: number }> | null, fd: FormData): Promise<ActionResult<{ cancelled: number }>> {
  const teamId = str(fd, "teamId");
  const slug = str(fd, "slug");
  const scope = str(fd, "scope") === "future" ? "future" : "one";
  const res = await runAction((ctx) => cancelTeamEvent(ctx, str(fd, "eventId"), { scope }));
  if (res.ok) revalidate(slug, teamId);
  return res;
}
