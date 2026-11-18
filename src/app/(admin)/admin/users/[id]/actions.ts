"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  changeOrgRole,
  deactivateUser,
  restoreUser,
  updateUserProfileAdmin,
} from "@/lib/dal/users-admin";

// Authorization (board / super admin / last-super-admin rules) is enforced inside the DAL.

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function revalidateUser(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

export async function changeRoleAction(userId: string, role: string): Promise<ActionResult> {
  const result = await runAction((ctx) => changeOrgRole(ctx, userId, role));
  if (result.ok) revalidateUser(userId);
  return result;
}

export async function updateProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const userId = str(formData, "userId");
  const result = await runAction((ctx) =>
    updateUserProfileAdmin(ctx, userId, { name: str(formData, "name"), phone: str(formData, "phone") })
  );
  if (result.ok) revalidateUser(userId);
  return result;
}

export async function deactivateAction(userId: string, reason: string): Promise<ActionResult> {
  const result = await runAction((ctx) => deactivateUser(ctx, userId, reason));
  if (result.ok) revalidateUser(userId);
  return result;
}

export async function restoreAction(userId: string): Promise<ActionResult> {
  const result = await runAction((ctx) => restoreUser(ctx, userId));
  if (result.ok) revalidateUser(userId);
  return result;
}
