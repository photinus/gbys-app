"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { createSeason, createWaiverVersion } from "@/lib/dal/seasons";
import { seasonInputFromForm } from "@/lib/validation/seasons";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export async function createSeasonAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const programId = str(formData, "programId");
  const slug = str(formData, "slug");
  const res = await runAction((ctx) => createSeason(ctx, programId, seasonInputFromForm(formData)));
  if (res.ok) {
    revalidatePath("/programs");
    revalidatePath(`/programs/${slug}`);
  }
  return res;
}

export interface CreatedWaiver {
  id: string;
  programId: string | null;
  title: string;
  version: string;
  body: string;
  bodyHash: string;
  createdAt: string;
  createdByName: string | null;
}

export async function createWaiverVersionAction(
  _prev: ActionResult<CreatedWaiver> | null,
  formData: FormData
): Promise<ActionResult<CreatedWaiver>> {
  return runAction(async (ctx) => {
    const w = await createWaiverVersion(ctx, {
      programId: str(formData, "programId"),
      title: str(formData, "title"),
      version: str(formData, "version"),
      body: str(formData, "body"),
    });
    return { ...w, createdAt: w.createdAt.toISOString() };
  });
}
