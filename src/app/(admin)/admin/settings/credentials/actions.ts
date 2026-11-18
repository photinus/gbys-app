"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  archiveCredentialType,
  createCredentialType,
  restoreCredentialType,
  updateCredentialType,
} from "@/lib/dal/credential-types";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function revalidate() {
  revalidatePath("/admin/settings/credentials");
  revalidatePath("/admin/programs", "layout");
  revalidatePath("/volunteer/credentials");
}

export async function createCredentialTypeAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const res = await runAction((ctx) =>
    createCredentialType(ctx, {
      code: str(formData, "code"),
      name: str(formData, "name"),
      description: str(formData, "description"),
      defaultValidityMonths: str(formData, "defaultValidityMonths"),
    })
  );
  if (res.ok) revalidate();
  return res;
}

export async function updateCredentialTypeAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult<{ changed: string[] }>> {
  const id = str(formData, "id");
  const res = await runAction((ctx) =>
    updateCredentialType(ctx, id, {
      name: str(formData, "name"),
      description: str(formData, "description"),
      defaultValidityMonths: str(formData, "defaultValidityMonths"),
    })
  );
  if (res.ok) revalidate();
  return res;
}

export async function setCredentialTypeActiveAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult<{ requiredByPrograms: { id: string; name: string }[] }>> {
  const id = str(formData, "id");
  const restore = str(formData, "intent") === "restore";
  const res = await runAction((ctx) => (restore ? restoreCredentialType(ctx, id) : archiveCredentialType(ctx, id)));
  if (res.ok) revalidate();
  return res;
}
