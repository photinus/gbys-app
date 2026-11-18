import "server-only";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  approveAssignment,
  archiveRole,
  assignVolunteer,
  createRole,
  declineAssignment,
  endAssignment,
  restoreRole,
  updateRole,
} from "@/lib/dal/volunteer-roles";
import { assignInputFromForm, roleInputFromForm } from "@/lib/validation/volunteer-roles";

// Shared by the program-roles and admin-volunteer-roles server actions. Authorization and
// validation live in the DAL; these only translate FormData and refresh affected pages.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/programs", "layout");
  revalidatePath("/admin/volunteer-roles");
  revalidatePath("/volunteer/roles");
  revalidatePath("/dashboard");
}

async function done<T>(res: ActionResult<T>): Promise<ActionResult<T>> {
  if (res.ok) refresh();
  return res;
}

export async function createRoleImpl(fd: FormData, orgWide: boolean) {
  const input = roleInputFromForm(fd);
  if (orgWide) input.programId = "";
  return done(await runAction((ctx) => createRole(ctx, input)));
}

export async function updateRoleImpl(fd: FormData) {
  return done(await runAction((ctx) => updateRole(ctx, str(fd, "id"), roleInputFromForm(fd))));
}

export async function archiveRoleImpl(id: string) {
  return done(await runAction((ctx) => archiveRole(ctx, id)));
}

export async function restoreRoleImpl(id: string) {
  return done(await runAction((ctx) => restoreRole(ctx, id)));
}

export async function approveImpl(fd: FormData) {
  return done(await runAction((ctx) => approveAssignment(ctx, str(fd, "id"), str(fd, "note"))));
}

export async function declineImpl(fd: FormData) {
  return done(await runAction((ctx) => declineAssignment(ctx, str(fd, "id"), str(fd, "reason"))));
}

export async function endImpl(fd: FormData) {
  return done(await runAction((ctx) => endAssignment(ctx, str(fd, "id"), str(fd, "reason"))));
}

export async function assignImpl(fd: FormData) {
  return done(await runAction((ctx) => assignVolunteer(ctx, assignInputFromForm(fd))));
}
