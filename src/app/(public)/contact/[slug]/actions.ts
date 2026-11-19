"use server";

import { getClientIp } from "@/lib/client-ip";

import { headers } from "next/headers";
import { submitContactForm } from "@/lib/dal/contact-submit";
import type { ContactSubmitResult } from "@/lib/validation/contact-submit";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Trusted client IP (see src/lib/client-ip.ts). */
function clientIp(h: Headers) {
  return getClientIp(h);
}

/** Public action (no session): used by both /contact/[slug] and /embed/contact/[slug]. */
export async function submitContactAction(
  _prev: ContactSubmitResult | null,
  formData: FormData
): Promise<ContactSubmitResult> {
  const h = await headers();
  let answers: unknown = {};
  try {
    const raw = str(formData, "answers");
    if (raw.length > 60_000) throw new Error("too large");
    answers = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, code: "invalid", error: "Your answers could not be read. Reload the page and try again." };
  }
  try {
    return await submitContactForm(
      {
        slug: str(formData, "slug"),
        name: str(formData, "name"),
        email: str(formData, "email"),
        phone: str(formData, "phone"),
        message: str(formData, "message"),
        answers,
        website: str(formData, "hp_url"),
        turnstileToken: str(formData, "cf-turnstile-response"),
        referrer: str(formData, "referrer"),
      },
      { ip: clientIp(h), userAgent: h.get("user-agent"), referer: h.get("referer"), host: h.get("host") }
    );
  } catch (err) {
    console.error("[contact] submit failed", err);
    return { ok: false, code: "unavailable", error: "Something went wrong. Please try again in a moment." };
  }
}
