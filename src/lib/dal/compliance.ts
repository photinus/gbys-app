import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { credentialDefinitions, userCredentials, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sendCredentialReviewedEmail } from "@/lib/email";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import { credentialKeyPrefix, getCredentialUploadUrl, getPrivateDocumentReadUrl } from "@/lib/storage";
import {
  queueFilterSchema,
  reviewSchema,
  submitCredentialSchema,
  uploadRequestSchema,
  type QueueFilter,
  type ReviewInput,
  type SubmitCredentialInput,
  type UploadRequestInput,
} from "@/lib/validation/compliance";
import { DalError, isBoard, type SessionContext } from "./context";

export type CredentialStatus = (typeof userCredentials.$inferSelect)["status"];

export interface CredentialDefinitionRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultValidityMonths: number;
}

export interface MyCredentialRow {
  id: string;
  definitionId: string;
  definitionName: string;
  issuerPartner: string;
  referenceNumber: string | null;
  status: CredentialStatus;
  issuedAt: Date | null;
  expiresAt: Date | null;
  reviewerNotes: string | null;
  reviewedAt: Date | null;
  hasProof: boolean;
  createdAt: Date;
}

export interface QueueRow extends MyCredentialRow {
  userId: string;
  volunteerName: string;
  volunteerEmail: string;
  reviewerName: string | null;
}

export interface ComplianceSummary {
  pending: number;
  verified: number;
  expiringIn30: number;
  expired: number;
}

const EXPIRING_WINDOW_DAYS = 30;
const QUEUE_LIMIT = 500;

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

/** issuedAt + N calendar months, evaluated in America/Los_Angeles (end of that day). */
function addMonthsLa(from: Date, months: number): Date {
  const [y, m, d] = utcToLaDateInput(from).split("-").map(Number);
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return laDateInputToUtc(`${ty}-${pad(tm + 1)}-${pad(Math.min(d, lastDay))}`);
}

export async function listCredentialDefinitions(ctx: SessionContext): Promise<CredentialDefinitionRow[]> {
  void ctx; // any signed-in user may see the (non-sensitive) definition catalog
  // Active types only: archived types can't be newly submitted (existing credentials still list via joins).
  return db
    .select({
      id: credentialDefinitions.id,
      code: credentialDefinitions.code,
      name: credentialDefinitions.name,
      description: credentialDefinitions.description,
      defaultValidityMonths: credentialDefinitions.defaultValidityMonths,
    })
    .from(credentialDefinitions)
    .where(eq(credentialDefinitions.isActive, true))
    .orderBy(asc(credentialDefinitions.name));
}

export async function listMyCredentials(ctx: SessionContext): Promise<MyCredentialRow[]> {
  const rows = await db
    .select({
      id: userCredentials.id,
      definitionId: userCredentials.definitionId,
      definitionName: credentialDefinitions.name,
      issuerPartner: userCredentials.issuerPartner,
      referenceNumber: userCredentials.referenceNumber,
      status: userCredentials.status,
      issuedAt: userCredentials.issuedAt,
      expiresAt: userCredentials.expiresAt,
      reviewerNotes: userCredentials.reviewerNotes,
      reviewedAt: userCredentials.verifiedAt,
      hasProof: sql<boolean>`${userCredentials.proofObjectKey} is not null`,
      createdAt: userCredentials.createdAt,
    })
    .from(userCredentials)
    .innerJoin(credentialDefinitions, eq(credentialDefinitions.id, userCredentials.definitionId))
    .where(eq(userCredentials.userId, ctx.userId))
    .orderBy(desc(userCredentials.createdAt));
  return rows;
}

/** Presigned PUT URL for a proof file. Validates type/size before touching storage. */
export async function createProofUploadUrl(
  ctx: SessionContext,
  input: UploadRequestInput
): Promise<{ uploadUrl: string; objectKey: string }> {
  const data = uploadRequestSchema.parse(input);
  const [def] = await db
    .select({ id: credentialDefinitions.id, isActive: credentialDefinitions.isActive })
    .from(credentialDefinitions)
    .where(eq(credentialDefinitions.id, data.definitionId))
    .limit(1);
  if (!def) throw new DalError("NOT_FOUND", "Unknown credential type.");
  if (!def.isActive) throw new DalError("INVALID", "That credential type is no longer accepted.");

  return getCredentialUploadUrl({
    userId: ctx.userId,
    fileName: data.fileName,
    contentType: data.contentType,
    contentLength: data.size,
  });
}

export async function submitCredential(
  ctx: SessionContext,
  input: SubmitCredentialInput
): Promise<{ id: string }> {
  const data = submitCredentialSchema.parse(input);

  // The proof must live under the caller's own prefix (no claiming someone else's upload).
  if (!data.proofObjectKey.startsWith(credentialKeyPrefix(ctx.userId)) || data.proofObjectKey.includes("..")) {
    throw new DalError("INVALID", "Invalid proof upload.");
  }

  const [def] = await db
    .select()
    .from(credentialDefinitions)
    .where(eq(credentialDefinitions.id, data.definitionId))
    .limit(1);
  if (!def) throw new DalError("NOT_FOUND", "Unknown credential type.");
  if (!def.isActive) throw new DalError("INVALID", "That credential type is no longer accepted.");

  const expiresAt = data.expiresAt ?? addMonthsLa(data.issuedAt, def.defaultValidityMonths);

  return db.transaction(async (tx) => {
    // Serialize concurrent submissions for the same (user, definition).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.userId + ":" + def.id}))`);
    const [pending] = await tx
      .select({ id: userCredentials.id })
      .from(userCredentials)
      .where(
        and(
          eq(userCredentials.userId, ctx.userId),
          eq(userCredentials.definitionId, def.id),
          eq(userCredentials.status, "pending_review")
        )
      )
      .limit(1);
    if (pending) {
      throw new DalError("INVALID", "You already have a submission for this credential awaiting review.");
    }

    const [row] = await tx
      .insert(userCredentials)
      .values({
        userId: ctx.userId,
        definitionId: def.id,
        issuerPartner: data.issuerPartner,
        referenceNumber: data.referenceNumber,
        status: "pending_review",
        issuedAt: data.issuedAt,
        expiresAt,
        proofObjectKey: data.proofObjectKey,
      })
      .returning({ id: userCredentials.id });

    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "credential.submitted",
        targetType: "user_credential",
        targetId: row.id,
        metadata: { definitionCode: def.code },
      },
      tx
    );
    return row;
  });
}

/** Short-lived presigned read URL. Owner or board only; every call is audited. */
export async function getCredentialProofUrl(ctx: SessionContext, credentialId: string): Promise<string> {
  const id = parseCredentialId(credentialId);
  const [cred] = await db
    .select({
      id: userCredentials.id,
      userId: userCredentials.userId,
      proofObjectKey: userCredentials.proofObjectKey,
    })
    .from(userCredentials)
    .where(eq(userCredentials.id, id))
    .limit(1);
  if (!cred) throw new DalError("NOT_FOUND", "Credential not found.");
  if (cred.userId !== ctx.userId && !isBoard(ctx)) {
    // Do not reveal existence to non-owners.
    throw new DalError("NOT_FOUND", "Credential not found.");
  }
  if (!cred.proofObjectKey) throw new DalError("NOT_FOUND", "No proof was uploaded for this credential.");

  await writeAudit({
    actorUserId: ctx.userId,
    action: "credential.proof_viewed",
    targetType: "user_credential",
    targetId: cred.id,
    metadata: { ownerUserId: cred.userId },
  });
  return getPrivateDocumentReadUrl(cred.proofObjectKey);
}

function parseCredentialId(v: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new DalError("NOT_FOUND", "Credential not found.");
  }
  return v;
}

export async function listVerificationQueue(
  ctx: SessionContext,
  filter: QueueFilter = "all"
): Promise<QueueRow[]> {
  requireBoard(ctx);
  const f = queueFilterSchema.parse(filter);
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000);

  let where: SQL | undefined;
  switch (f) {
    case "pending_review":
      where = eq(userCredentials.status, "pending_review");
      break;
    case "rejected":
      where = eq(userCredentials.status, "rejected");
      break;
    case "verified":
      where = and(
        eq(userCredentials.status, "verified"),
        or(isNull(userCredentials.expiresAt), gte(userCredentials.expiresAt, now))
      );
      break;
    case "expiring":
      where = and(
        eq(userCredentials.status, "verified"),
        gte(userCredentials.expiresAt, now),
        lte(userCredentials.expiresAt, soon)
      );
      break;
    case "expired":
      where = or(
        eq(userCredentials.status, "expired"),
        and(eq(userCredentials.status, "verified"), lt(userCredentials.expiresAt, now))
      );
      break;
    default:
      where = undefined;
  }

  const reviewer = alias(users, "reviewer");
  const rows = await db
    .select({
      id: userCredentials.id,
      userId: userCredentials.userId,
      volunteerName: users.name,
      volunteerEmail: users.email,
      definitionId: userCredentials.definitionId,
      definitionName: credentialDefinitions.name,
      issuerPartner: userCredentials.issuerPartner,
      referenceNumber: userCredentials.referenceNumber,
      status: userCredentials.status,
      issuedAt: userCredentials.issuedAt,
      expiresAt: userCredentials.expiresAt,
      reviewerNotes: userCredentials.reviewerNotes,
      reviewedAt: userCredentials.verifiedAt,
      reviewerName: reviewer.name,
      hasProof: sql<boolean>`${userCredentials.proofObjectKey} is not null`,
      createdAt: userCredentials.createdAt,
    })
    .from(userCredentials)
    .innerJoin(users, eq(users.id, userCredentials.userId))
    .innerJoin(credentialDefinitions, eq(credentialDefinitions.id, userCredentials.definitionId))
    .leftJoin(reviewer, eq(reviewer.id, userCredentials.verifiedByUserId))
    .where(and(isNull(users.deletedAt), where))
    .orderBy(
      sql`case when ${userCredentials.status} = 'pending_review' then 0 else 1 end`,
      sql`case when ${userCredentials.status} = 'pending_review' then ${userCredentials.createdAt} end asc`,
      desc(userCredentials.updatedAt)
    )
    .limit(QUEUE_LIMIT);

  await writeAudit({
    actorUserId: ctx.userId,
    action: "compliance.queue_viewed",
    targetType: "compliance_queue",
    targetId: "verification_queue",
    metadata: { filter: f, count: rows.length },
  });
  return rows;
}

export async function reviewCredential(
  ctx: SessionContext,
  credentialId: string,
  input: ReviewInput
): Promise<{ status: CredentialStatus }> {
  requireBoard(ctx);
  const data = reviewSchema.parse(input);
  const id = parseCredentialId(credentialId);

  const result = await db.transaction(async (tx) => {
    // Lock the row so concurrent reviewers cannot both decide.
    const [cred] = await tx
      .select({
        id: userCredentials.id,
        userId: userCredentials.userId,
        status: userCredentials.status,
        issuedAt: userCredentials.issuedAt,
        definitionName: credentialDefinitions.name,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(userCredentials)
      .innerJoin(credentialDefinitions, eq(credentialDefinitions.id, userCredentials.definitionId))
      .innerJoin(users, eq(users.id, userCredentials.userId))
      .where(eq(userCredentials.id, id))
      .for("update", { of: userCredentials })
      .limit(1);

    if (!cred) throw new DalError("NOT_FOUND", "Credential not found.");
    if (cred.userId === ctx.userId) {
      throw new DalError("FORBIDDEN", "You cannot review your own credential. Ask another board member.");
    }
    if (cred.status !== "pending_review") {
      throw new DalError("INVALID", "This credential has already been reviewed.");
    }
    const now = new Date();
    if (data.expiresAt && data.expiresAt.getTime() <= now.getTime()) {
      throw new DalError("INVALID", "Expiration must be in the future.");
    }

    await tx
      .update(userCredentials)
      .set({
        status: data.decision,
        reviewerNotes: data.reviewerNotes || null,
        verifiedByUserId: ctx.userId,
        verifiedAt: now,
        ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
      })
      .where(and(eq(userCredentials.id, id), eq(userCredentials.status, "pending_review")));

    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: data.decision === "verified" ? "credential.verified" : "credential.rejected",
        targetType: "user_credential",
        targetId: id,
        metadata: { ownerUserId: cred.userId, hasNotes: !!data.reviewerNotes },
      },
      tx
    );
    return cred;
  });

  // Best-effort notification: a mail failure must not undo the committed review.
  try {
    await sendCredentialReviewedEmail({
      to: result.ownerEmail,
      name: result.ownerName || "there",
      credentialName: result.definitionName,
      decision: data.decision,
      notes: data.reviewerNotes || undefined,
    });
  } catch (err) {
    console.error("[compliance] failed to send review email", err);
  }

  return { status: data.decision };
}

export async function getComplianceSummary(ctx: SessionContext): Promise<ComplianceSummary> {
  requireBoard(ctx);
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86_400_000);
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${userCredentials.status} = 'pending_review')::int`,
      verified: sql<number>`count(*) filter (where ${userCredentials.status} = 'verified' and (${userCredentials.expiresAt} is null or ${userCredentials.expiresAt} >= ${now}))::int`,
      expiringIn30: sql<number>`count(*) filter (where ${userCredentials.status} = 'verified' and ${userCredentials.expiresAt} >= ${now} and ${userCredentials.expiresAt} <= ${soon})::int`,
      expired: sql<number>`count(*) filter (where ${userCredentials.status} = 'expired' or (${userCredentials.status} = 'verified' and ${userCredentials.expiresAt} < ${now}))::int`,
    })
    .from(userCredentials)
    .innerJoin(users, eq(users.id, userCredentials.userId))
    .where(isNull(users.deletedAt));
  return row;
}
