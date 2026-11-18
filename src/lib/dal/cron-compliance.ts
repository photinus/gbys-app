import "server-only";
import { and, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { pool, db } from "@/db";
import { credentialDefinitions, programRoles, programs, userCredentials, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sendComplianceLapseAlertEmail, sendCredentialExpiringEmail } from "@/lib/email";
import { formatDate } from "@/lib/format";

// System job: runs with no SessionContext (the allowed exception to the DAL ctx rule).

const DAY_MS = 86_400_000;
const LOCK_KEY = 7_201_811; // arbitrary app-wide advisory lock id for this job

export interface ComplianceSweepSummary {
  ranAt: string;
  expired: number;
  warnings30Sent: number;
  warnings7Sent: number;
  warningFailures: number;
  lapseAlertsSent: number;
  lapseAlertFailures: number;
  skipped?: "already_running";
}

/** True when the owner holds another verified credential of the same type that outlives this one. */
function renewedElsewhere(c: typeof userCredentials) {
  const other = sql`(select 1 from ${userCredentials} o where o.user_id = ${c.userId} and o.definition_id = ${c.definitionId} and o.id <> ${c.id} and o.status = 'verified' and (o.expires_at is null or o.expires_at > ${c.expiresAt}))`;
  return sql`not exists ${other}`;
}

async function sendWarnings(now: Date, kind: 30 | 7) {
  const in7 = new Date(now.getTime() + 7 * DAY_MS);
  const in30 = new Date(now.getTime() + 30 * DAY_MS);
  const window =
    kind === 30
      ? and(gt(userCredentials.expiresAt, in7), lte(userCredentials.expiresAt, in30), isNull(userCredentials.expiryWarning30SentAt))
      : and(gt(userCredentials.expiresAt, now), lte(userCredentials.expiresAt, in7), isNull(userCredentials.expiryWarning7SentAt));

  const rows = await db
    .select({
      id: userCredentials.id,
      expiresAt: userCredentials.expiresAt,
      credentialName: credentialDefinitions.name,
      email: users.email,
      name: users.name,
    })
    .from(userCredentials)
    .innerJoin(users, eq(users.id, userCredentials.userId))
    .innerJoin(credentialDefinitions, eq(credentialDefinitions.id, userCredentials.definitionId))
    .where(
      and(
        eq(userCredentials.status, "verified"),
        window,
        eq(users.emailBounced, false),
        isNull(users.deletedAt),
        renewedElsewhere(userCredentials)
      )
    );

  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await sendCredentialExpiringEmail({
        to: r.email,
        volunteerName: r.name || "there",
        credentialName: r.credentialName,
        expiresAtDate: formatDate(r.expiresAt!),
      });
      // Stamp only after a successful send so failures retry on the next run.
      await db
        .update(userCredentials)
        .set(kind === 30 ? { expiryWarning30SentAt: now } : { expiryWarning7SentAt: now })
        .where(eq(userCredentials.id, r.id));
      sent++;
    } catch (err) {
      failed++;
      console.error(`[cron-compliance] ${kind}-day warning failed for credential ${r.id}`, err);
    }
  }
  return { sent, failed };
}

async function sendLapseAlerts(expired: { userId: string; definitionId: string; expiresAt: Date | null }[]) {
  let sent = 0;
  let failed = 0;
  if (expired.length === 0) return { sent, failed };

  const [defs, board] = await Promise.all([
    db.select({ id: credentialDefinitions.id, name: credentialDefinitions.name }).from(credentialDefinitions),
    db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(
        and(inArray(users.orgRole, ["super_admin", "board_member"]), eq(users.emailBounced, false), isNull(users.deletedAt))
      ),
  ]);
  const defName = new Map(defs.map((d) => [d.id, d.name]));

  for (const cred of expired) {
    // Owner may have already renewed: no lapse then.
    const [renewed] = await db
      .select({ id: userCredentials.id })
      .from(userCredentials)
      .where(
        and(
          eq(userCredentials.userId, cred.userId),
          eq(userCredentials.definitionId, cred.definitionId),
          eq(userCredentials.status, "verified"),
          or(isNull(userCredentials.expiresAt), gt(userCredentials.expiresAt, new Date()))
        )
      )
      .limit(1);
    if (renewed) continue;

    const [coach] = await db
      .select({ name: users.name })
      .from(users)
      .where(and(eq(users.id, cred.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!coach) continue;

    const coachPrograms = await db
      .selectDistinct({ id: programs.id, name: programs.name })
      .from(programRoles)
      .innerJoin(programs, eq(programs.id, programRoles.programId))
      .where(
        and(
          eq(programRoles.userId, cred.userId),
          inArray(programRoles.role, ["head_coach", "assistant_coach"]),
          eq(programs.isActive, true),
          isNull(programs.deletedAt),
          sql`${programs.requiredCredentialIds} @> ${JSON.stringify([cred.definitionId])}::jsonb`
        )
      );

    for (const program of coachPrograms) {
      const admins = await db
        .selectDistinct({ id: users.id, email: users.email, name: users.name })
        .from(programRoles)
        .innerJoin(users, eq(users.id, programRoles.userId))
        .where(
          and(
            eq(programRoles.programId, program.id),
            eq(programRoles.role, "program_admin"),
            ne(users.id, cred.userId),
            eq(users.emailBounced, false),
            isNull(users.deletedAt)
          )
        );
      const recipients = admins.length > 0 ? admins : board.filter((b) => b.id !== cred.userId);
      for (const r of recipients) {
        try {
          await sendComplianceLapseAlertEmail({
            to: r.email,
            recipientName: r.name || "there",
            coachName: coach.name || "A coach",
            programName: program.name,
            credentialName: defName.get(cred.definitionId) ?? "credential",
            expiredAt: cred.expiresAt!,
          });
          sent++;
        } catch (err) {
          failed++;
          console.error("[cron-compliance] lapse alert failed", err);
        }
      }
    }
  }
  return { sent, failed };
}

export async function runComplianceSweep(now: Date = new Date()): Promise<ComplianceSweepSummary> {
  // Single-flight: overlapping runs would double-send before the dedup stamps land.
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query("select pg_try_advisory_lock($1) as ok", [LOCK_KEY]);
    if (!rows[0].ok) {
      return {
        ranAt: now.toISOString(),
        expired: 0,
        warnings30Sent: 0,
        warnings7Sent: 0,
        warningFailures: 0,
        lapseAlertsSent: 0,
        lapseAlertFailures: 0,
        skipped: "already_running",
      };
    }
    try {
      // 1. Expire.
      const expiredRows = await db
        .update(userCredentials)
        .set({ status: "expired" })
        .where(and(eq(userCredentials.status, "verified"), lt(userCredentials.expiresAt, now)))
        .returning({
          id: userCredentials.id,
          userId: userCredentials.userId,
          definitionId: userCredentials.definitionId,
          expiresAt: userCredentials.expiresAt,
        });
      for (const c of expiredRows) {
        await writeAudit({
          actorUserId: null,
          action: "credential.expired",
          targetType: "user_credential",
          targetId: c.id,
          metadata: { ownerUserId: c.userId, definitionId: c.definitionId },
        });
      }

      // 2-3. Warnings (30-day window excludes the 7-day window).
      const w30 = await sendWarnings(now, 30);
      const w7 = await sendWarnings(now, 7);

      // 5. Lapse alerts for credentials expired in this run.
      const lapse = await sendLapseAlerts(expiredRows);

      const summary: ComplianceSweepSummary = {
        ranAt: now.toISOString(),
        expired: expiredRows.length,
        warnings30Sent: w30.sent,
        warnings7Sent: w7.sent,
        warningFailures: w30.failed + w7.failed,
        lapseAlertsSent: lapse.sent,
        lapseAlertFailures: lapse.failed,
      };
      await writeAudit({
        actorUserId: null,
        action: "cron.compliance_run",
        targetType: "cron",
        targetId: "compliance",
        metadata: { ...summary },
      });
      return summary;
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}
