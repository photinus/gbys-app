"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { submitRegistration, type SubmitResult } from "@/lib/dal/registrations";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** First x-forwarded-for hop, else x-real-ip. */
function clientIp(h: Headers): string | null {
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || h.get("x-real-ip")?.trim() || null;
}

export async function submitRegistrationAction(
  _prev: ActionResult<SubmitResult> | null,
  formData: FormData,
): Promise<ActionResult<SubmitResult>> {
  const h = await headers();
  let answers: unknown = {};
  try {
    answers = JSON.parse(str(formData, "answers") || "{}");
  } catch {
    return { ok: false, error: "Your answers could not be read. Reload the page and try again." };
  }
  const res = await runAction((ctx) =>
    submitRegistration(
      ctx,
      {
        seasonId: str(formData, "seasonId"),
        athleteId: str(formData, "athleteId"),
        answers,
        waiverVersionId: str(formData, "waiverVersionId"),
        signatureName: str(formData, "signatureName"),
        agree: formData.get("agree") === "on",
      },
      { ipAddress: clientIp(h), userAgent: h.get("user-agent") },
    ),
  );
  if (res.ok) {
    revalidatePath("/registrations");
    revalidatePath("/register/[slug]", "page");
  }
  return res;
}
