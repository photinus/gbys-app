import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, type DbTx } from "@/db";
import { paymentEvents, programRoles, programs, registrations, seasons, users, athletes } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sendPaymentDisputeEmail } from "@/lib/email";
import { formatCents } from "@/lib/format";
import { getStripe, isStripeEnabled, stripeRequestOptions } from "@/lib/stripe";
import { reasonSchema } from "@/lib/validation/rosters";
import { DalError, type SessionContext } from "./context";
import { postPaymentEventSafely } from "./finance-autopost";
import { assertProgramReachable, canManageProgram } from "./permissions";

/**
 * Refunds, disputes and the payment ledger (worker PC).
 *
 * The ledger is written ONLY by the Stripe webhook (handleChargeRefunded /
 * handleDisputeEvent, called inside the webhook's transaction which also
 * inserted the webhook_events idempotency row) and by the offline payment DAL.
 * refundRegistration just asks Stripe for the refund; the `charge.refunded`
 * event is the single source of truth, so refunds issued from the league's own
 * Stripe dashboard land in exactly the same way.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Initiating a refund (program admin / board)
// ---------------------------------------------------------------------------
export interface RefundInput {
  /** Defaults to the remaining refundable balance. */
  amountCents?: number;
  reason: string;
}

export interface RefundResult {
  refundId: string;
  amountCents: number;
  status: string | null;
}

export async function refundRegistration(
  ctx: SessionContext,
  registrationId: string,
  input: RefundInput
): Promise<RefundResult> {
  if (!UUID_RE.test(registrationId)) throw new DalError("NOT_FOUND", "Registration not found.");
  const reason = reasonSchema.parse(input.reason);

  const [row] = await db
    .select({
      id: registrations.id,
      seasonId: registrations.seasonId,
      programId: seasons.programId,
      paymentStatus: registrations.paymentStatus,
      paymentMethod: registrations.paymentMethod,
      amountPaidCents: registrations.amountPaidCents,
      refundedCents: registrations.refundedCents,
      paymentIntentId: registrations.stripePaymentIntentId,
      stripeAccountId: registrations.stripeAccountId,
    })
    .from(registrations)
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .where(eq(registrations.id, registrationId))
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Registration not found.");
  if (!canManageProgram(ctx, row.programId)) {
    throw new DalError("FORBIDDEN", "You do not have permission to refund payments.");
  }
  await assertProgramReachable(ctx, row.programId);
  if (row.paymentMethod !== "stripe" || !row.paymentIntentId || row.paymentStatus !== "paid") {
    throw new DalError("INVALID", "Only a card payment taken in the app can be refunded here.");
  }

  const paid = row.amountPaidCents ?? 0;
  const remaining = paid - row.refundedCents;
  if (remaining <= 0) throw new DalError("INVALID", "This payment has already been fully refunded.");
  const amount = input.amountCents ?? remaining;
  if (!Number.isInteger(amount) || amount <= 0) throw new DalError("INVALID", "Enter a refund amount greater than $0.");
  if (amount > remaining) {
    throw new DalError("INVALID", `You can refund at most ${formatCents(remaining)} on this payment.`);
  }

  // The key repeats for a double-submit of the same refund (same amount, same
  // already-refunded balance) and changes once the webhook records a refund.
  const idempotencyKey = `refund:${row.id}:${amount}:${row.refundedCents}`;
  if (!isStripeEnabled()) throw new DalError("INVALID", "Stripe is not configured, so card payments cannot be refunded here.");
  let refund: Stripe.Refund;
  try {
    refund = await getStripe().refunds.create(
      {
        payment_intent: row.paymentIntentId,
        amount,
        reason: "requested_by_customer",
        refund_application_fee: true,
        metadata: { registrationId: row.id, requestedBy: ctx.userId },
      },
      { ...stripeRequestOptions(row.stripeAccountId), idempotencyKey }
    );
  } catch (err) {
    const e = err as { type?: string; message?: string };
    if (e.type === "StripeInvalidRequestError" || e.type === "StripeIdempotencyError") {
      throw new DalError("INVALID", `Stripe could not refund this payment: ${e.message ?? "invalid request"}`);
    }
    console.error("[refund] Stripe error", e.type ?? "unknown", (e as { detail?: { message?: string } }).detail?.message ?? e.message);
    throw new DalError("INVALID", "Stripe could not be reached. Nothing was refunded; please try again.");
  }

  await writeAudit({
    actorUserId: ctx.userId,
    action: "payment.refund_requested",
    targetType: "registration",
    targetId: row.id,
    metadata: {
      seasonId: row.seasonId,
      amountCents: amount,
      reason,
      refundId: refund.id,
      refundStatus: refund.status,
      stripeAccountId: row.stripeAccountId,
      previousRefundedCents: row.refundedCents,
    },
  });
  return { refundId: refund.id, amountCents: amount, status: refund.status };
}

// ---------------------------------------------------------------------------
// Webhook handlers (system actor; run inside the webhook transaction)
// ---------------------------------------------------------------------------
function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

type RegForStripe = {
  id: string;
  seasonId: string;
  programId: string;
  programName: string;
  programSlug: string;
  athleteName: string;
  amountPaidCents: number | null;
  refundedCents: number;
  disputedAt: Date | null;
  stripeAccountId: string | null;
  paymentIntentId: string | null;
  paymentStatus: string;
};

async function findRegistration(
  tx: DbTx,
  paymentIntentId: string | null,
  metadataRegistrationId: string | null
): Promise<RegForStripe | null> {
  const conds = [];
  if (paymentIntentId) conds.push(eq(registrations.stripePaymentIntentId, paymentIntentId));
  if (metadataRegistrationId && UUID_RE.test(metadataRegistrationId)) conds.push(eq(registrations.id, metadataRegistrationId));
  if (conds.length === 0) return null;
  const rows = await tx
    .select({
      id: registrations.id,
      seasonId: registrations.seasonId,
      programId: seasons.programId,
      programName: programs.name,
      programSlug: programs.slug,
      athleteFirst: athletes.firstName,
      athleteLast: athletes.lastName,
      amountPaidCents: registrations.amountPaidCents,
      refundedCents: registrations.refundedCents,
      disputedAt: registrations.disputedAt,
      stripeAccountId: registrations.stripeAccountId,
      paymentIntentId: registrations.stripePaymentIntentId,
      paymentStatus: registrations.paymentStatus,
    })
    .from(registrations)
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .where(or(...conds))
    // Prefer the payment-intent match; lock the row so concurrent deliveries serialize.
    .orderBy(sql`(${registrations.stripePaymentIntentId} is not distinct from ${paymentIntentId}) desc`)
    .limit(1)
    .for("update", { of: registrations });
  const r = rows[0];
  if (!r) return null;
  return { ...r, athleteName: `${r.athleteFirst} ${r.athleteLast}`.trim() };
}

/** True when the event's account matches the account the registration was charged on. */
function accountMatches(reg: RegForStripe, accountId: string | null): boolean {
  return (reg.stripeAccountId ?? null) === (accountId ?? null);
}

/**
 * `charge.refunded`: one ledger row per Stripe refund (keyed re_…, redelivery
 * and concurrent deliveries are no-ops), refundedCents mirrors the charge, and
 * a full refund flips the registration to `refunded`.
 */
export async function handleChargeRefunded(tx: DbTx, charge: Stripe.Charge, accountId: string | null): Promise<void> {
  const pi = idOf(charge.payment_intent);
  const reg = await findRegistration(tx, pi, charge.metadata?.registrationId ?? null);
  if (!reg) {
    console.log(`[stripe] charge.refunded for unknown charge ${charge.id}; ignored`);
    return;
  }
  if (reg.paymentIntentId && pi && reg.paymentIntentId !== pi) {
    console.warn(`[stripe] charge ${charge.id} payment intent does not match registration ${reg.id}; ignored`);
    return;
  }
  if (!accountMatches(reg, accountId)) {
    console.warn(`[stripe] charge ${charge.id} account mismatch for registration ${reg.id}; ignored`);
    return;
  }

  // The refunds list is not included in webhook payloads on recent API versions
  // (it is expandable); fall back to listing them when it is missing or partial.
  const counted = (rs: Stripe.Refund[]) => rs.filter((r) => r.status !== "failed" && r.status !== "canceled");
  let refunds = counted(charge.refunds?.data ?? []);
  const sum = (rs: Stripe.Refund[]) => rs.reduce((n, r) => n + r.amount, 0);
  if (charge.refunds?.has_more || sum(refunds) !== charge.amount_refunded) {
    const listed = await getStripe().refunds.list({ charge: charge.id, limit: 100 }, stripeRequestOptions(accountId));
    refunds = counted(listed.data);
  }

  let inserted = 0;
  for (const rf of refunds) {
    const res = await tx
      .insert(paymentEvents)
      .values({
        registrationId: reg.id,
        programId: reg.programId,
        kind: "refund",
        amountCents: rf.amount,
        currency: rf.currency ?? charge.currency ?? "usd",
        stripeObjectId: rf.id,
        stripeAccountId: accountId,
        method: "stripe",
        note: rf.reason ? `Reason: ${rf.reason}` : null,
        recordedByUserId: null,
        occurredAt: new Date(rf.created * 1000),
      })
      .onConflictDoNothing({ target: paymentEvents.stripeObjectId })
      .returning({ id: paymentEvents.id });
    inserted += res.length;
    if (res.length) await postPaymentEventSafely(tx, res[0].id);
  }

  const refundedCents = charge.amount_refunded;
  const fullyRefunded = (reg.amountPaidCents ?? 0) > 0 && refundedCents >= (reg.amountPaidCents ?? 0);
  const newStatus = fullyRefunded && reg.paymentStatus === "paid" ? ("refunded" as const) : null;
  if (inserted === 0 && refundedCents === reg.refundedCents && !newStatus) return; // nothing new

  await tx
    .update(registrations)
    .set({ refundedCents, ...(newStatus ? { paymentStatus: newStatus } : {}) })
    .where(eq(registrations.id, reg.id));
  await writeAudit(
    {
      actorUserId: null,
      action: "payment.refunded",
      targetType: "registration",
      targetId: reg.id,
      metadata: {
        seasonId: reg.seasonId,
        chargeId: charge.id,
        refundIds: refunds.map((r) => r.id),
        newLedgerRows: inserted,
        refundedCents,
        previousRefundedCents: reg.refundedCents,
        amountPaidCents: reg.amountPaidCents,
        fullyRefunded,
        stripeAccountId: accountId,
      },
    },
    tx
  );
}

async function programAdminEmails(tx: DbTx, programId: string): Promise<string[]> {
  const admins = await tx
    .selectDistinct({ email: users.email })
    .from(programRoles)
    .innerJoin(users, eq(users.id, programRoles.userId))
    .where(and(eq(programRoles.programId, programId), eq(programRoles.role, "program_admin"), isNull(users.deletedAt)));
  if (admins.length > 0) return admins.map((a) => a.email);
  const board = await tx
    .select({ email: users.email })
    .from(users)
    .where(and(inArray(users.orgRole, ["super_admin", "board_member"]), isNull(users.deletedAt)));
  return board.map((b) => b.email);
}

/**
 * `charge.dispute.created` (opened) / `charge.dispute.closed` (closed). Ledger
 * rows are keyed `dp_…:opened` / `dp_…:closed` so redelivery is a no-op.
 */
export async function handleDisputeEvent(
  tx: DbTx,
  dispute: Stripe.Dispute,
  accountId: string | null,
  phase: "opened" | "closed"
): Promise<void> {
  let pi = idOf(dispute.payment_intent);
  if (!pi && typeof dispute.charge === "string") {
    try {
      const ch = await getStripe().charges.retrieve(dispute.charge, {}, stripeRequestOptions(accountId));
      pi = idOf(ch.payment_intent);
    } catch (e) {
      console.warn("[stripe] could not look up charge for dispute", dispute.id, (e as { type?: string }).type);
    }
  } else if (!pi && dispute.charge && typeof dispute.charge === "object") {
    pi = idOf(dispute.charge.payment_intent);
  }
  const reg = await findRegistration(tx, pi, dispute.metadata?.registrationId ?? null);
  if (!reg) {
    console.log(`[stripe] dispute ${dispute.id} for unknown payment; ignored`);
    return;
  }
  if (!accountMatches(reg, accountId)) {
    console.warn(`[stripe] dispute ${dispute.id} account mismatch for registration ${reg.id}; ignored`);
    return;
  }

  const kind = phase === "opened" ? "dispute_opened" : "dispute_closed";
  const outcome = dispute.status;
  const note =
    phase === "opened"
      ? `Reason: ${dispute.reason}`
      : `Outcome: ${outcome}${outcome === "won" || outcome === "warning_closed" ? " (funds returned)" : outcome === "lost" ? " (funds withdrawn)" : ""}`;
  const res = await tx
    .insert(paymentEvents)
    .values({
      registrationId: reg.id,
      programId: reg.programId,
      kind,
      amountCents: dispute.amount,
      currency: dispute.currency ?? "usd",
      stripeObjectId: `${dispute.id}:${phase}`,
      stripeAccountId: accountId,
      method: "stripe",
      note,
      recordedByUserId: null,
      occurredAt: phase === "opened" ? new Date(dispute.created * 1000) : new Date(),
    })
    .onConflictDoNothing({ target: paymentEvents.stripeObjectId })
    .returning({ id: paymentEvents.id });
  if (res.length === 0) return; // redelivery
  await postPaymentEventSafely(tx, res[0].id);

  if (phase === "opened") {
    if (!reg.disputedAt) {
      await tx.update(registrations).set({ disputedAt: new Date() }).where(eq(registrations.id, reg.id));
    }
    await writeAudit(
      {
        actorUserId: null,
        action: "payment.dispute_opened",
        targetType: "registration",
        targetId: reg.id,
        metadata: { seasonId: reg.seasonId, disputeId: dispute.id, amountCents: dispute.amount, reason: dispute.reason, stripeAccountId: accountId },
      },
      tx
    );
    try {
      const base = (process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
      await sendPaymentDisputeEmail({
        to: await programAdminEmails(tx, reg.programId),
        programName: reg.programName,
        athleteName: reg.athleteName,
        amountText: formatCents(dispute.amount),
        reason: dispute.reason,
        ledgerUrl: `${base}/programs/${reg.programSlug}/payments/ledger`,
      });
    } catch (e) {
      console.error("[stripe] dispute email failed", dispute.id, (e as Error).message);
    }
  } else {
    // A won dispute returns the funds: clear the badge. A lost one stays flagged.
    if (outcome === "won" || outcome === "warning_closed") {
      await tx.update(registrations).set({ disputedAt: null }).where(eq(registrations.id, reg.id));
    } else if (!reg.disputedAt) {
      await tx.update(registrations).set({ disputedAt: new Date() }).where(eq(registrations.id, reg.id));
    }
    await writeAudit(
      {
        actorUserId: null,
        action: "payment.dispute_closed",
        targetType: "registration",
        targetId: reg.id,
        metadata: { seasonId: reg.seasonId, disputeId: dispute.id, amountCents: dispute.amount, outcome, stripeAccountId: accountId },
      },
      tx
    );
  }
}
