// Edge-safe (used by middleware). Sites allowed to embed /embed/* pages in an
// iframe, from EMBED_ALLOWED_ORIGINS: space- or comma-separated origins, e.g.
// "https://goldbeachyouthsports.org https://www.goldbeachyouthsports.org".
// Only https origins (http allowed for localhost dev) are accepted; anything
// malformed is dropped. Empty -> 'self' only (the hosted /contact page still works).

export function embedAllowedOrigins(): string[] {
  const raw = process.env.EMBED_ALLOWED_ORIGINS ?? "";
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    if (!part) continue;
    try {
      const u = new URL(part);
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if (u.protocol !== "https:" && !(local && u.protocol === "http:")) continue;
      if (u.pathname !== "/" || u.search || u.hash || u.username) continue;
      out.push(u.origin);
    } catch {
      // ignore malformed entries
    }
  }
  return [...new Set(out)];
}

/** Value for CSP frame-ancestors on embeddable pages. */
export function embedFrameAncestors(): string {
  return ["'self'", ...embedAllowedOrigins()].join(" ");
}
