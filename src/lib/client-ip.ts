// Client IP behind Railway's edge proxy. Never trust the FIRST X-Forwarded-For
// hop: the client can send any value there. Railway's edge sets X-Real-IP to the
// connecting address; failing that, the LAST X-Forwarded-For entry is the one
// appended by our proxy. Used for rate limiting and the IP stored on e-signatures.
type HeaderBag = { get(name: string): string | null };

export const TRUSTED_CLIENT_IP_HEADER = "x-real-ip";

export function getClientIp(h: HeaderBag): string | null {
  const real = h.get(TRUSTED_CLIENT_IP_HEADER)?.trim();
  if (real) return real.slice(0, 64);
  const parts = h.get("x-forwarded-for")?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  const last = parts[parts.length - 1];
  return last ? last.slice(0, 64) : null;
}
