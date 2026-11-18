"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { removeLogo, updateOrgSettings, uploadLogo } from "@/lib/dal/settings";

// Authorization (board-only) is enforced inside the DAL; inputs are validated again there.
// Uploaded logos (<= 512 KB + multipart overhead) fit Next's default 1 MB server action body limit.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function revalidateBranding() {
  revalidatePath("/", "layout"); // org name / logo appear on every page
}

export async function updateSettingsAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult<{ changed: string[] }>> {
  const section = str(formData, "section");
  const res = await runAction((ctx) =>
    updateOrgSettings(
      ctx,
      section === "valuation"
        ? {
            section: "valuation",
            inKindRateDollars: str(formData, "inKindRateDollars"),
            inKindRateSource: str(formData, "inKindRateSource"),
          }
        : {
            section: "profile",
            orgName: str(formData, "orgName"),
            shortName: str(formData, "shortName"),
            legalDesignation: str(formData, "legalDesignation"),
            ein: str(formData, "ein"),
            supportEmail: str(formData, "supportEmail"),
            websiteUrl: str(formData, "websiteUrl"),
          }
    )
  );
  if (res.ok) revalidateBranding();
  return res;
}

export async function uploadLogoAction(
  _prev: ActionResult<unknown> | null,
  formData: FormData
): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await uploadLogo(ctx, formData);
  });
  if (res.ok) revalidateBranding();
  return res;
}

export async function removeLogoAction(): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await removeLogo(ctx);
  });
  if (res.ok) revalidateBranding();
  return res;
}
