"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  checkPathAvailability,
  removeSiteImage,
  saveCustomDomain,
  saveSiteAddress,
  saveSiteContent,
  saveSiteLook,
  saveSiteSections,
  setSitePublished,
  uploadSiteImage,
  type SiteWriteEffect,
} from "@/lib/dal/program-sites-admin";
import { contentInputFromForm, parseSectionsJson } from "@/lib/validation/program-sites";
import type { SiteSection } from "@/db/schema";

// Authorization (canManageProgram; board-only for the domain) and validation live in the DAL.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Revalidate every public and admin page a write can affect. */
function revalidateSite(e: SiteWriteEffect) {
  revalidatePath(`/programs/${e.programSlug}`);
  revalidatePath(`/programs/${e.programSlug}/home-page`);
  revalidatePath(`/programs/${e.programSlug}/home-page/preview`);
  for (const p of e.pathSlugs) revalidatePath(`/${p}`);
  for (const d of e.domains) revalidatePath(`/sites/domain/${d}`);
  if (e.affectsMainSite || e.changed.length > 0) revalidatePath("/");
  if (e.affectsMainSite) revalidatePath("/dashboard");
  revalidatePath("/admin/programs/[id]", "page");
}

export async function saveContentAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction((ctx) => saveSiteContent(ctx, str(fd, "programId"), contentInputFromForm(fd)));
  if (res.ok) revalidateSite(res.data);
  return res;
}

export async function saveLookAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction((ctx) => saveSiteLook(ctx, str(fd, "programId"), { accentColor: str(fd, "accentColor") }));
  if (res.ok) revalidateSite(res.data);
  return res;
}

export async function saveSectionsAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<SiteWriteEffect & { sections: SiteSection[] }>> {
  const res = await runAction((ctx) => saveSiteSections(ctx, str(fd, "programId"), parseSectionsJson(str(fd, "sections"))));
  if (res.ok) revalidateSite(res.data);
  return res;
}

export async function saveAddressAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction((ctx) =>
    saveSiteAddress(ctx, str(fd, "programId"), { pathSlug: str(fd, "pathSlug"), listOnMainSite: str(fd, "listOnMainSite") === "on" })
  );
  if (res.ok) revalidateSite(res.data);
  return res;
}

export async function saveDomainAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction((ctx) => saveCustomDomain(ctx, str(fd, "programId"), { customDomain: str(fd, "customDomain") }));
  if (res.ok) revalidateSite(res.data);
  return res;
}

export async function setPublishedAction(programId: string, published: boolean) {
  const res = await runAction((ctx) => setSitePublished(ctx, programId, published));
  if (res.ok) revalidateSite(res.data);
  return res;
}

export async function uploadImageAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  const kind = str(fd, "kind");
  const res = await runAction((ctx) =>
    uploadSiteImage(ctx, str(fd, "programId"), kind === "logo" ? "logo" : "hero", fd.get("file"))
  );
  if (res.ok) revalidateSite(res.data);
  return res;
}

export async function removeImageAction(programId: string, kind: "hero" | "logo") {
  const res = await runAction((ctx) => removeSiteImage(ctx, programId, kind));
  if (res.ok) revalidateSite(res.data);
  return res;
}

/** Live availability hint for the path field (read-only). */
export async function checkPathAction(programId: string, path: string) {
  return runAction((ctx) => checkPathAvailability(ctx, programId, path));
}
