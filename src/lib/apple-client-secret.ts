import "server-only";
import { createPrivateKey, sign } from "node:crypto";

/**
 * Sign in with Apple does not use a static client secret. Apple requires the
 * "secret" to be an ES256 JWT signed with the .p8 key from the developer
 * account, and caps its lifetime at 6 months (15777000 seconds). Rather than
 * asking an admin to paste a freshly minted JWT every few months, we hold the
 * long-lived private key in env and mint the JWT synchronously at process
 * start. Every Railway redeploy therefore regenerates it, so there is no manual
 * rotation. Caveat: a single process that stays up for more than ~180 days
 * would be presenting an expired secret and needs a restart/redeploy.
 */

const APPLE_AUDIENCE = "https://appleid.apple.com";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days
const MAX_TTL_SECONDS = 15777000; // Apple's hard limit (~6 months)

export interface AppleClientSecretInput {
  teamId: string;
  keyId: string;
  /** The Services ID (web) or bundle ID used as `sub`. */
  clientId: string;
  /** Contents of the .p8 file. Literal "\n" sequences (env-var friendly) are accepted. */
  privateKeyPem: string;
  ttlSeconds?: number;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function createAppleClientSecret({
  teamId,
  keyId,
  clientId,
  privateKeyPem,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: AppleClientSecretInput): string {
  if (!teamId || !keyId || !clientId) {
    throw new Error("Apple client secret: teamId, keyId and clientId are required");
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Apple client secret: ttlSeconds must be a positive number");
  }
  const ttl = Math.min(Math.floor(ttlSeconds), MAX_TTL_SECONDS);

  // Env vars often carry the PEM on one line with literal "\n"; also tolerate
  // surrounding quotes and CRLF.
  const pem = privateKeyPem
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");

  let key;
  try {
    key = createPrivateKey({ key: pem, format: "pem" });
  } catch (err) {
    throw new Error(
      `Apple client secret: APPLE_PRIVATE_KEY is not a valid PEM private key (${(err as Error).message})`,
    );
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Apple client secret: the private key must be an EC P-256 key (the .p8 from Apple)");
  }

  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: keyId };
  const claims = { iss: teamId, iat, exp: iat + ttl, aud: APPLE_AUDIENCE, sub: clientId };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  // JWS ES256 needs the raw r||s (IEEE P1363) signature, not DER.
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}
