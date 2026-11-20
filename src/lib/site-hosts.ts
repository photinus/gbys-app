// Edge-safe (used by middleware): which request hosts are "the app" vs a program's
// custom domain, and which first path segments are reserved app routes.
//
// Primary hosts = host of BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL, RAILWAY_PUBLIC_DOMAIN
// (set by Railway), APP_PRIMARY_HOSTS (comma/space list), Railway's health-check host,
// and localhost. Any other host is treated as a possible program custom domain.

const ALWAYS_PRIMARY = ["localhost", "127.0.0.1", "[::1]", "healthcheck.railway.app"];

/** "Example.org:443." -> "example.org". Returns "" for junk. */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return "";
  let h = raw.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : "";
  }
  h = h.replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9.-]{1,253}$/.test(h) ? h : "";
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeHost(new URL(url).host) || null;
  } catch {
    return null;
  }
}

export function primaryHosts(): Set<string> {
  const out = new Set<string>(ALWAYS_PRIMARY);
  for (const h of [hostOf(process.env.BETTER_AUTH_URL), hostOf(process.env.NEXT_PUBLIC_APP_URL)]) if (h) out.add(h);
  const railway = normalizeHost(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railway) out.add(railway);
  for (const part of (process.env.APP_PRIMARY_HOSTS ?? "").split(/[\s,]+/)) {
    const h = normalizeHost(part);
    if (h) out.add(h);
  }
  return out;
}

export function isPrimaryHost(host: string): boolean {
  return !host || primaryHosts().has(host);
}

/** Origin for absolute links back to the app (sign-in, registration) from a custom domain. */
export function primaryOrigin(): string {
  for (const u of [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!u) continue;
    try {
      return new URL(u).origin;
    } catch {
      // try the next one
    }
  }
  return "http://localhost:3000";
}

/**
 * Validate a custom domain entered by the board: bare hostname, at least one dot,
 * labels 1-63 chars, not an app (primary) host. Returns the normalized value or null.
 */
export function parseCustomDomain(input: string): string | null {
  const h = normalizeHost(input.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""));
  if (!h || h.startsWith("[") || !h.includes(".") || h.length > 253) return null;
  if (!h.split(".").every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (/^\d+(\.\d+){3}$/.test(h)) return null; // no raw IPs
  if (isPrimaryHost(h)) return null;
  return h;
}

/**
 * First path segments owned by the app — a program path slug may not use them.
 * Keep in sync with top-level folders in src/app (route groups excluded) and /public.
 */
export const RESERVED_PATH_SEGMENTS = new Set([
  "admin", "api", "board", "brand", "calendar", "contact", "dashboard", "embed", "finance",
  "household", "media", "programs", "register", "registrations", "reimbursements", "schedule",
  "sign-in", "sign-up", "sign-out", "sites", "teams", "volunteer", "manifest.webmanifest",
  "embed.js", "icons", "sw.js", "favicon.ico", "robots.txt", "sitemap.xml", "_next", "privacy",
  "terms", "help", "about", "login", "logout", "account", "settings", "static", "public", "www",
]);

export function isValidPathSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug) && !RESERVED_PATH_SEGMENTS.has(slug);
}

/** Paths a custom domain may serve directly (assets); everything else but "/" redirects to the app. */
export function isCustomDomainPassthrough(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/sites/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.webmanifest"
  );
}
