import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const ALLOWED_PROOF_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
] as const;
export type ProofContentType = (typeof ALLOWED_PROOF_TYPES)[number];

export const MAX_PROOF_BYTES = 10 * 1024 * 1024; // 10 MB

export function credentialKeyPrefix(userId: string) {
  return `credentials/${userId}/`;
}

let s3: S3Client | null = null;

function getS3(): S3Client {
  s3 ??= new S3Client({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    forcePathStyle: true,
    // Railway (S3-compatible) rejects the SDK's default flexible checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return s3;
}

function bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not configured");
  return b;
}

export async function getCredentialUploadUrl({
  userId,
  fileName,
  contentType,
  contentLength,
}: {
  userId: string;
  fileName: string;
  contentType: string;
  contentLength: number;
}) {
  if (!(ALLOWED_PROOF_TYPES as readonly string[]).includes(contentType)) {
    throw new Error("Unsupported file type");
  }
  if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_PROOF_BYTES) {
    throw new Error("File is empty or too large");
  }

  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const key = `${credentialKeyPrefix(userId)}${Date.now()}-${sanitized}`;

  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  const uploadUrl = await getSignedUrl(getS3(), command, { expiresIn: 300 });
  return { uploadUrl, objectKey: key };
}

export async function getPrivateDocumentReadUrl(objectKey: string) {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: objectKey,
  });

  return getSignedUrl(getS3(), command, { expiresIn: 300 });
}

// ---- Server-side private objects (photos). No browser PUT, so no bucket CORS needed. ----

export async function putPrivateObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getS3().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType, ContentLength: body.length })
  );
}

/** Returns the object bytes, or null if it does not exist. */
export async function getPrivateObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const res = await getS3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    if (!res.Body) return null;
    const bytes = await res.Body.transformToByteArray();
    return { body: Buffer.from(bytes), contentType: res.ContentType ?? "application/octet-stream" };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

export async function deletePrivateObject(key: string): Promise<void> {
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  await getS3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
