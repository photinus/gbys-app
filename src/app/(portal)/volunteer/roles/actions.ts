"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { signUpForRole, withdrawMyAssignment } from "@/lib/dal/volunteer-role-signups";
import { parseTermValue } from "@/lib/validation/volunteer-role-signups";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function revalidateRoles() {
  revalidatePath("/volunteer/roles");
  revalidatePath("/volunteer/hours");
  revalidatePath("/dashboard");
  revalidatePath("/admin/volunteer-roles");
  revalidatePath("/admin");
}

export async function signUpForRoleAction(
  _prev: ActionResult<{ id: string; status: "pending" | "active" }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string; status: "pending" | "active" }>> {
  const term = parseTermValue(str(formData, "term"));
  const result = await runAction((ctx) =>
    signUpForRole(ctx, {
      roleId: str(formData, "roleId"),
      seasonId: term.seasonId,
      year: term.year,
      note: str(formData, "note") || null,
    })
  );
  if (result.ok) revalidateRoles();
  return result;
}

export async function withdrawMyAssignmentAction(assignmentId: string): Promise<ActionResult> {
  const result = await runAction((ctx) => withdrawMyAssignment(ctx, assignmentId));
  if (result.ok) revalidateRoles();
  return result;
}
