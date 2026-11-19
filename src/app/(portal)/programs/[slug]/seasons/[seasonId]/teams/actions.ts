"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  addTeamStaff,
  assignPlayers,
  createTeam,
  removePlayer,
  removeTeamStaff,
  setJerseyNumber,
  suggestTeamStaff,
  updateTeam,
  type AddStaffResult,
  type AssignResult,
  type StaffSuggestion,
} from "@/lib/dal/teams";
import type { TeamStaffRoleValue } from "@/lib/validation/teams";

// Authorization (canManageProgram / board) is enforced inside the DAL.

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function revalidateBuilder(fd: FormData) {
  // `path` is the builder page the form was rendered on; only revalidate a matching shape.
  const path = str(fd, "path");
  if (/^\/programs\/[a-z0-9-]+\/seasons\/[0-9a-f-]{36}\/teams$/i.test(path)) revalidatePath(path);
  revalidatePath("/teams");
}

export async function createTeamAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction((ctx) =>
    createTeam(ctx, str(fd, "seasonId"), { name: str(fd, "name"), division: str(fd, "division"), color: str(fd, "color") })
  );
  if (res.ok) revalidateBuilder(fd);
  return res;
}

export async function updateTeamAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction((ctx) =>
    updateTeam(ctx, str(fd, "teamId"), {
      name: str(fd, "name"),
      division: str(fd, "division"),
      color: str(fd, "color"),
      isActive: fd.get("isActive") === "on",
    })
  );
  if (res.ok) {
    revalidateBuilder(fd);
    revalidatePath(`/programs/${str(fd, "slug").replace(/[^a-z0-9-]/gi, "")}/teams/${str(fd, "teamId").replace(/[^0-9a-f-]/gi, "")}`);
  }
  return res;
}

/** Assign (or move) one or many registrations: `registrationId` may repeat. */
export async function assignPlayersAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<AssignResult>> {
  const res = await runAction((ctx) =>
    assignPlayers(ctx, str(fd, "teamId"), fd.getAll("registrationId").filter((v): v is string => typeof v === "string"))
  );
  if (res.ok) revalidateBuilder(fd);
  return res;
}

export async function removePlayerAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction((ctx) => removePlayer(ctx, str(fd, "teamPlayerId")));
  if (res.ok) revalidateBuilder(fd);
  return res;
}

export async function setJerseyAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction((ctx) => setJerseyNumber(ctx, str(fd, "teamPlayerId"), str(fd, "jersey")));
  if (res.ok) revalidateBuilder(fd);
  return res;
}

export async function addStaffAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<AddStaffResult>> {
  const res = await runAction((ctx) =>
    addTeamStaff(ctx, str(fd, "teamId"), { email: str(fd, "email"), role: str(fd, "role") as TeamStaffRoleValue })
  );
  if (res.ok) revalidateBuilder(fd);
  return res;
}

export async function removeStaffAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction((ctx) => removeTeamStaff(ctx, str(fd, "teamStaffId")));
  if (res.ok) revalidateBuilder(fd);
  return res;
}

export async function suggestStaffAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<StaffSuggestion[]>> {
  return runAction((ctx) => suggestTeamStaff(ctx, str(fd, "teamId")));
}
