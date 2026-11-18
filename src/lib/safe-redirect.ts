/**
 * Returns `next` only if it is a same-origin relative path (a single leading
 * `/`), otherwise "/dashboard". Blocks open redirects such as `//evil.com`,
 * `/\evil.com`, absolute URLs, and control characters.
 */
export function safeNext(next?: string | null): string {
  const fallback = "/dashboard";
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return next;
}
