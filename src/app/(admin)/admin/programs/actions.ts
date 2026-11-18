"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { createProgram, grantProgramRole, revokeProgramRole, updateProgram } from "@/lib/dal/programs";
import { createProgramSchema, grantRoleSchema, updateProgramSchema } from "@/lib/validation/programs";

// Authorization (board-only) is enforced inside the DAL; inputs are validated with zod here
// and again inside the DAL.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on";

function programFields(fd: FormData) {
  return {
    name: str(fd, "name"),
    slug: str(fd, "slug"),
    sport: str(fd, "sport"),
    description: str(fd, "description"),
    isIndependentPartner: bool(fd, "isIndependentPartner"),
    requiredCredentialIds: fd.getAll("requiredCredentialId").map(String),
  };
}

export async function createProgramAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async (ctx) => {
    const input = programFields(formData);
    createProgramSchema.parse(input); // fail fast with the first friendly message
    return createProgram(ctx, input);
  });
  if (res.ok) revalidatePath("/admin/programs");
  return res;
}

export async function updateProgramAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult> {
  const id = str(formData, "id");
  const res = await runAction(async (ctx) => {
    const input = { ...programFields(formData), isActive: bool(formData, "isActive") };
    updateProgramSchema.parse(input);
    await updateProgram(ctx, id, input);
  });
  if (res.ok) {
    revalidatePath("/admin/programs");
    revalidatePath(`/admin/programs/${id}`);
  }
  return res;
}

export async function grantRoleAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult> {
  const programId = str(formData, "programId");
  const res = await runAction(async (ctx) => {
    const parsed = grantRoleSchema.parse({ programId, email: str(formData, "email"), role: str(formData, "role") });
    await grantProgramRole(ctx, parsed);
  });
  if (res.ok) revalidatePath(`/admin/programs/${programId}`);
  return res;
}

export async function revokeRoleAction(programId: string, roleId: string): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await revokeProgramRole(ctx, roleId);
  });
  if (res.ok) {
    revalidatePath("/admin/programs");
    revalidatePath(`/admin/programs/${programId}`);
  }
  return res;
}
