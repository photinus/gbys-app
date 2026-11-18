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
  | "compliance.queue_viewed"
  | "credential.expired"
  | "cron.compliance_run"
  | "program.created"
  | "program.updated"
  | "program_role.granted"
  | "program_role.revoked"
  | "shift.created"
  | "shift.updated"
  | "shift.cancelled"
  | "shift.signed_up"
  | "shift.signup_cancelled"
  | "shift.checked_in"
  | "shift.checkin_undone"
  | "hours.logged"
  | "hours.approved"
  | "hours.rejected"
  | "hours.deleted"
  | "grant.report_viewed"
  | "grant.exported"
  | "season.created"
  | "season.updated"
  | "waiver.version_created"
  | "waiver.signed"
  | "registration.created"
  | "registration.withdrawn"
  | "registration.cancelled"
  | "payment.recorded"
  | "payment.voided"
  | "roster.viewed"
  | "user.role_changed"
  | "user.profile_updated"
  | "user.deactivated"
  | "user.restored"
  | "settings.updated"
  | "branding.logo_updated"
  | "branding.logo_removed"
  | "credential_definition.created"
  | "credential_definition.updated"
  | "credential_definition.archived"
  | "credential_definition.restored"
  | "audit.viewed";

export type AuditTarget =
  | "athlete"
  | "user"
  | "household_invite"
  | "user_credential"
  | "compliance_queue"
  | "cron"
  | "program"
  | "program_role"
  | "volunteer_shift"
  | "shift_signup"
  | "volunteer_log"
  | "grant_report"
  | "season"
  | "waiver_version"
  | "signed_waiver"
  | "registration"
  | "org_settings"
  | "credential_definition"
  | "audit_log";

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
