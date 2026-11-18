import { createHash } from "node:crypto";

/**
 * Canonical hash of a waiver body (invariant 5). Normalises line endings so the
 * same text hashes identically regardless of the browser that submitted it.
 * Server-only (node:crypto).
 */
export function normalizeWaiverBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

export function hashWaiverBody(body: string): string {
  return createHash("sha256").update(normalizeWaiverBody(body), "utf8").digest("hex");
}
