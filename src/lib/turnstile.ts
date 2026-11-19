import "server-only";

// Cloudflare's documented always-pass test keys (dev only; never used in production).
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

function resolveKeys(): { siteKey: string; secretKey: string; enabled: boolean; isTest: boolean } {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() ?? "";
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() ?? "";
  if (siteKey && secretKey) {
    return { siteKey, secretKey, enabled: true, isTest: secretKey === TEST_SECRET_KEY };
  }
  if (process.env.NODE_ENV === "production") {
    // Production requires both keys; a half-configured pair is treated as missing.
    return { siteKey: "", secretKey: "", enabled: false, isTest: false };
  }
  return { siteKey: TEST_SITE_KEY, secretKey: TEST_SECRET_KEY, enabled: true, isTest: true };
}

/** Public widget config. `enabled: false` means the form must show "temporarily unavailable". */
export function getTurnstileConfig(): { siteKey: string; enabled: boolean } {
  const { siteKey, enabled } = resolveKeys();
  return { siteKey, enabled };
}

function hostnameOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export type TurnstileResult = { ok: true } | { ok: false; reason: "disabled" | "missing" | "failed" | "hostname" | "network" };

/**
 * Server-side siteverify. Requires success === true and, except for the dev test keys,
 * that the token's `hostname` is our app host (BETTER_AUTH_URL's host or the request host).
 * Any network error / timeout counts as failure.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
  requestHost?: string | null
): Promise<TurnstileResult> {
  const keys = resolveKeys();
  if (!keys.enabled) return { ok: false, reason: "disabled" };
  if (!token || token.length > 2048) return { ok: false, reason: "missing" };

  const body = new URLSearchParams({ secret: keys.secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  let data: { success?: unknown; hostname?: unknown };
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "network" };
    data = await res.json();
  } catch {
    return { ok: false, reason: "network" };
  }
  if (data.success !== true) return { ok: false, reason: "failed" };

  if (!keys.isTest) {
    const allowed = new Set(
      [hostnameOf(process.env.BETTER_AUTH_URL), hostnameOf(requestHost)].filter((h): h is string => !!h)
    );
    const got = typeof data.hostname === "string" ? data.hostname.toLowerCase() : "";
    if (!got || !allowed.has(got)) return { ok: false, reason: "hostname" };
  }
  return { ok: true };
}
