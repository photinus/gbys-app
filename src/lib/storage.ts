import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.S3_BUCKET!;

export async function getCredentialUploadUrl({
  userId,
  fileName,
  contentType,
}: {
  userId: string;
  fileName: string;
  contentType: string;
}) {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `credentials/${userId}/${Date.now()}-${sanitized}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  return { uploadUrl, objectKey: key };
}

export async function getPrivateDocumentReadUrl(objectKey: string) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
  });

  return getSignedUrl(s3, command, { expiresIn: 300 });
}
