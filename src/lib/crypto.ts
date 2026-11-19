import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level secret encryption (AES-256-GCM) for credentials we must
 * store and later use, e.g. the SimpleFIN access URL (it embeds basic-auth
 * credentials that can read every bank transaction).
 *
 * Key: FINANCE_ENCRYPTION_KEY = 32 random bytes, base64 (`openssl rand -base64 32`).
 * Ciphertext format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 * Rotating the key means re-connecting SimpleFIN (old ciphertexts become unreadable).
 */

export class EncryptionUnavailableError extends Error {
  constructor() {
    super("FINANCE_ENCRYPTION_KEY is not configured.");
    this.name = "EncryptionUnavailableError";
  }
}

function key(): Buffer {
  const raw = process.env.FINANCE_ENCRYPTION_KEY;
  if (!raw) throw new EncryptionUnavailableError();
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("FINANCE_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return k;
}

export function isEncryptionConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, ct] = payload.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognized ciphertext format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}
