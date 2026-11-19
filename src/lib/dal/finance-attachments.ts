import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { finAttachments } from "@/db/schema";
import { ALLOWED_PROOF_TYPES, MAX_PROOF_BYTES, getPrivateObject, putPrivateObject } from "@/lib/storage";
import { DalError } from "./context";

/**
 * Finance attachments — shared low-level helpers (orchestrator contract).
 * These DO NOT authorize: the owning module (bills, invoices, gifts, contacts)
 * checks access to the owner record first, then calls these.
 * Files: PDF / PNG / JPEG / WebP / HEIC, <= 10 MB, private bucket only.
 */

export type FinAttachmentOwner = "bill" | "invoice" | "gift" | "contact_w9";

export interface FinAttachmentRow {
  id: string;
  ownerType: FinAttachmentOwner;
  ownerId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  createdAt: Date;
}

/** Validate and store an uploaded File (from a server action's FormData). */
export async function storeAttachment(
  tx: DbOrTx,
  args: { ownerType: FinAttachmentOwner; ownerId: string; file: File; userId: string }
): Promise<{ id: string }> {
  const { file } = args;
  if (!(file instanceof File) || file.size === 0) throw new DalError("INVALID", "Choose a file to upload.");
  if (file.size > MAX_PROOF_BYTES) throw new DalError("INVALID", "Files must be 10 MB or smaller.");
  if (!(ALLOWED_PROOF_TYPES as readonly string[]).includes(file.type)) {
    throw new DalError("INVALID", "Upload a PDF or a photo (PNG, JPEG, WebP or HEIC).");
  }
  const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const key = `finance/${args.ownerType}/${args.ownerId}/${Date.now()}-${safeName}`;
  await putPrivateObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  const [row] = await tx
    .insert(finAttachments)
    .values({
      ownerType: args.ownerType,
      ownerId: args.ownerId,
      objectKey: key,
      fileName: safeName,
      contentType: file.type,
      sizeBytes: file.size,
      uploadedByUserId: args.userId,
    })
    .returning({ id: finAttachments.id });
  return row;
}

export async function listAttachments(
  tx: DbOrTx,
  ownerType: FinAttachmentOwner,
  ownerId: string
): Promise<FinAttachmentRow[]> {
  const rows = await tx
    .select({
      id: finAttachments.id,
      ownerType: finAttachments.ownerType,
      ownerId: finAttachments.ownerId,
      fileName: finAttachments.fileName,
      contentType: finAttachments.contentType,
      sizeBytes: finAttachments.sizeBytes,
      uploadedByUserId: finAttachments.uploadedByUserId,
      createdAt: finAttachments.createdAt,
    })
    .from(finAttachments)
    .where(and(eq(finAttachments.ownerType, ownerType), eq(finAttachments.ownerId, ownerId), isNull(finAttachments.deletedAt)))
    .orderBy(finAttachments.createdAt);
  return rows as FinAttachmentRow[];
}

/** Attachment row (not deleted) — callers check `ownerType`/`ownerId` against what they authorized. */
export async function getAttachment(id: string, tx: DbOrTx = db) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await tx
    .select()
    .from(finAttachments)
    .where(and(eq(finAttachments.id, id), isNull(finAttachments.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Bytes for streaming back through an authorized route handler (Content-Disposition: attachment for PDFs is fine). */
export async function readAttachmentBytes(objectKey: string) {
  return getPrivateObject(objectKey);
}

/** Soft delete (the object stays in the bucket for the audit trail). */
export async function softDeleteAttachment(tx: DbOrTx, id: string, userId: string): Promise<void> {
  await tx
    .update(finAttachments)
    .set({ deletedAt: new Date(), deletedByUserId: userId })
    .where(and(eq(finAttachments.id, id), isNull(finAttachments.deletedAt)));
}
