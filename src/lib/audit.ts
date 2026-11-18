import "server-only";
import { db, type DbOrTx } from "@/db";
import { auditLogs } from "@/db/schema";

export type AuditAction =
  | "medical.viewed"
  | "medical.updated"
  | "athlete.created"
  | "profile.updated"
  | "guardian.invited"
  | "guardian.invite_revoked"
  | "guardian.invite_accepted"
  | "guardian.removed"
  | "credential.submitted"
  | "credential.proof_viewed"
  | "credential.verified"
  | "credential.rejected"
  | "compliance.queue_viewed";

export type AuditTarget =
  | "athlete"
  | "user"
  | "household_invite"
  | "user_credential"
  | "compliance_queue";

export async function writeAudit(
  e: {
    actorUserId: string | null;
    action: AuditAction;
    targetType: AuditTarget;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
  tx?: DbOrTx
): Promise<void> {
  await (tx ?? db).insert(auditLogs).values({
    actorUserId: e.actorUserId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    metadata: e.metadata ?? null,
  });
}
