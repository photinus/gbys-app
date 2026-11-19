import "server-only";
import { Nuntly } from "@nuntly/sdk";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, type DbTx } from "@/db";
import {
  athletes,
  paymentEvents,
  programRoles,
  programs,
  registrations,
  seasons,
  users,
  webhookEvents,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { escapeHtml } from "@/lib/email";
import { formatCents } from "@/lib/format";
import { handleAccountUpdated } from "./stripe-connect";
import { handleChargeRefunded, handleDisputeEvent } from "./stripe-refunds";

/**
 * Stripe webhook processing (system actor: the allowed DAL exception).
 *
 * Idempotency (invariant 6): one transaction inserts the webhook_events row
 * (ON CONFLICT DO NOTHING) and dispatches. A second delivery, even a
 * concurrent one, waits on the unique key and then sees "duplicate". If
 * dispatch throws the whole transaction rolls back (the caller returns 500 so
 * Stripe retries). A *refused* event (validation mismatch) also rolls back so
 * nothing but a forensic audit row is written, and is answered 200 because a
 * retry could never succeed.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StripeEventResult =
  | { status: "processed" }
  | { status: "duplicate" }
  | { status: "refused"; reason: string };

class RefusedError extends Error {
  constructor(
    public reason: string,
    public registrationId: string | null,
  ) {
    super(reason);
  }
}

type AfterCommit = Array<() => Promise<void>>;

function appBase(): string {
  return (process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export async function processStripeEvent(event: Stripe.Event): Promise<StripeEventResult> {
  const afterCommit: AfterCommit = [];
  try {
    const result = await db.transaction(async (tx): Promise<StripeEventResult> => {
      const inserted = await tx
        .insert(webhookEvents)
        .values({ id: event.id, provider: "stripe", eventType: event.type })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (inserted.length === 0) return { status: "duplicate" };
      await dispatch(tx, event, afterCommit);
      return { status: "processed" };
    });
    // Emails go out only after the money is durably recorded, and never fail the webhook.
    for (const run of afterCommit) {
      try {
        await run();
      } catch (err) {
        console.error("[stripe-webhook] notification failed", { eventId: event.id, message: (err as Error).message });
      }
    }
    return result;
  } catch (err) {
    if (err instanceof RefusedError) {
      console.error("[stripe-webhook] event refused", { eventId: event.id, type: event.type, reason: err.reason });
      // Forensics only; registration, ledger and webhook_events are untouched.
      try {
        await writeAudit({
          actorUserId: null,
          action: "payment.failed",
          targetType: "registration",
          targetId: err.registrationId ?? event.id,
          metadata: { refused: err.reason, eventId: event.id, eventType: event.type, stripeAccountId: event.account ?? null },
        });
      } catch {
        /* best effort */
      }
      return { status: "refused", reason: err.reason };
    }
    throw err;
  }
}

async function dispatch(tx: DbTx, event: Stripe.Event, afterCommit: AfterCommit): Promise<void> {
  const acct = event.account ?? null;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") await applySessionPaid(tx, event, session, afterCommit);
      else if (session.payment_status === "unpaid") await markSessionPending(tx, event, session);
      // "no_payment_required" never applies: free registrations are never sent to Checkout.
      return;
    }
    case "checkout.session.async_payment_succeeded": {
      await applySessionPaid(tx, event, event.data.object as Stripe.Checkout.Session, afterCommit);
      return;
    }
    case "checkout.session.async_payment_failed": {
      await applySessionFailed(tx, event, event.data.object as Stripe.Checkout.Session);
      return;
    }
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      await tx
        .update(registrations)
        .set({ stripeCheckoutSessionId: null })
        .where(
          and(
            eq(registrations.stripeCheckoutSessionId, session.id),
            sql`${registrations.stripeAccountId} is not distinct from ${acct}::text`,
            eq(registrations.paymentStatus, "unpaid"),
          ),
        );
      return;
    }
    case "charge.refunded":
      await handleChargeRefunded(tx, event.data.object as Stripe.Charge, acct);
      return;
    case "charge.dispute.created":
      await handleDisputeEvent(tx, event.data.object as Stripe.Dispute, acct, "opened");
      return;
    case "charge.dispute.closed":
      await handleDisputeEvent(tx, event.data.object as Stripe.Dispute, acct, "closed");
      return;
    case "account.updated":
      await handleAccountUpdated(event.data.object as Stripe.Account);
      return;
    default:
      return; // recorded in webhook_events, nothing to do
  }
}

// ---------------------------------------------------------------------------
// Checkout sessions
// ---------------------------------------------------------------------------
interface LoadedRegistration {
  id: string;
  feeCents: number;
  paymentStatus: "unpaid" | "pending" | "paid" | "waived_scholarship" | "refunded";
  deletedAt: Date | null;
  stripeAccountId: string | null;
  stripeCheckoutSessionId: string | null;
  platformFeeChargedCents: number | null;
  athleteName: string;
  seasonName: string;
  programId: string;
  programName: string;
  programSlug: string;
}

/** Locks and returns the registration a session refers to (null if the reference is unusable). */
async function lockRegistration(tx: DbTx, session: Stripe.Checkout.Session): Promise<LoadedRegistration | null> {
  const ref = session.client_reference_id;
  if (!ref || !UUID_RE.test(ref) || session.metadata?.registrationId !== ref) return null;
  const [row] = await tx
    .select({
      id: registrations.id,
      feeCents: registrations.feeCents,
      paymentStatus: registrations.paymentStatus,
      deletedAt: registrations.deletedAt,
      stripeAccountId: registrations.stripeAccountId,
      stripeCheckoutSessionId: registrations.stripeCheckoutSessionId,
      platformFeeChargedCents: registrations.platformFeeChargedCents,
      athleteFirst: athletes.firstName,
      athleteLast: athletes.lastName,
      seasonName: seasons.name,
      programId: programs.id,
      programName: programs.name,
      programSlug: programs.slug,
    })
    .from(registrations)
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .where(eq(registrations.id, ref))
    .for("update", { of: registrations })
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    feeCents: row.feeCents,
    paymentStatus: row.paymentStatus,
    deletedAt: row.deletedAt,
    stripeAccountId: row.stripeAccountId,
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    platformFeeChargedCents: row.platformFeeChargedCents,
    athleteName: `${row.athleteFirst} ${row.athleteLast}`,
    seasonName: row.seasonName,
    programId: row.programId,
    programName: row.programName,
    programSlug: row.programSlug,
  };
}

function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  return typeof pi === "string" ? pi : (pi?.id ?? null);
}

/** Strict checks shared by every path that records money. Throws RefusedError on any mismatch. */
async function loadAndValidate(
  tx: DbTx,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<{ reg: LoadedRegistration; pi: string }> {
  const reg = await lockRegistration(tx, session);
  const refId = UUID_RE.test(session.client_reference_id ?? "") ? session.client_reference_id : null;
  if (!reg) throw new RefusedError("registration reference missing, mismatched or unknown", refId);
  const acct = event.account ?? null;
  if ((reg.stripeAccountId ?? null) !== acct) throw new RefusedError("connected account does not match the checkout snapshot", reg.id);
  if (session.amount_total !== reg.feeCents) throw new RefusedError("amount does not match the registration fee", reg.id);
  if (session.currency !== "usd") throw new RefusedError("unexpected currency", reg.id);
  const pi = paymentIntentId(session);
  if (!pi) throw new RefusedError("session has no payment intent", reg.id);
  return { reg, pi };
}

async function applySessionPaid(
  tx: DbTx,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  afterCommit: AfterCommit,
): Promise<void> {
  const { reg, pi } = await loadAndValidate(tx, event, session);
  const acct = event.account ?? null;
  const cancelled = !!reg.deletedAt;
  const applicable = reg.paymentStatus === "unpaid" || reg.paymentStatus === "pending";
  const feeCents = acct ? reg.platformFeeChargedCents : null;

  // Ledger first: the unique pi_ key means completed + async_payment_succeeded (or any redelivery
  // under another event id) can never count the same charge twice.
  const note = cancelled
    ? "Paid after the registration was cancelled. Refund needed."
    : !applicable
      ? "Additional payment on an already settled registration. Refund needed."
      : null;
  const recorded = await tx
    .insert(paymentEvents)
    .values({
      registrationId: reg.id,
      programId: reg.programId,
      kind: "charge",
      amountCents: reg.feeCents,
      currency: "usd",
      applicationFeeCents: feeCents,
      stripeObjectId: pi,
      stripeAccountId: acct,
      method: "stripe",
      note,
      recordedByUserId: null,
      occurredAt: new Date(),
    })
    .onConflictDoNothing({ target: paymentEvents.stripeObjectId })
    .returning({ id: paymentEvents.id });
  if (recorded.length === 0) return; // this charge is already in the ledger

  if (applicable) {
    await tx
      .update(registrations)
      .set({
        paymentStatus: "paid",
        paymentMethod: "stripe",
        amountPaidCents: reg.feeCents,
        paidAt: new Date(),
        stripePaymentIntentId: pi,
      })
      .where(eq(registrations.id, reg.id));
  }
  await writeAudit(
    {
      actorUserId: null,
      action: "payment.succeeded",
      targetType: "registration",
      targetId: reg.id,
      metadata: {
        eventId: event.id,
        paymentIntentId: pi,
        sessionId: session.id,
        amountCents: reg.feeCents,
        stripeAccountId: acct,
        applicationFeeCents: feeCents,
        registrationStatusUpdated: applicable,
        ...(cancelled ? { cancelledRegistration: true } : {}),
        ...(!applicable && !cancelled ? { duplicatePayment: true } : {}),
      },
    },
    tx,
  );

  if (cancelled || !applicable) {
    const reason = cancelled
      ? "This registration was cancelled before the payment completed."
      : "This registration was already settled when this second payment arrived.";
    afterCommit.push(() => notifyAdminsRefundNeeded(reg, reason, reg.feeCents));
  }
}

/** Async payment methods: checkout completed but funds have not cleared yet. */
async function markSessionPending(tx: DbTx, event: Stripe.Event, session: Stripe.Checkout.Session): Promise<void> {
  const { reg, pi } = await loadAndValidate(tx, event, session);
  if (reg.deletedAt || reg.paymentStatus !== "unpaid") return;
  await tx
    .update(registrations)
    .set({ paymentStatus: "pending", stripePaymentIntentId: pi })
    .where(eq(registrations.id, reg.id));
}

async function applySessionFailed(tx: DbTx, event: Stripe.Event, session: Stripe.Checkout.Session): Promise<void> {
  const reg = await lockRegistration(tx, session);
  if (!reg || (reg.stripeAccountId ?? null) !== (event.account ?? null)) return; // nothing of ours to undo
  if (reg.paymentStatus !== "unpaid" && reg.paymentStatus !== "pending") return;
  await tx
    .update(registrations)
    .set({
      paymentStatus: "unpaid",
      ...(reg.stripeCheckoutSessionId === session.id ? { stripeCheckoutSessionId: null } : {}),
      ...(reg.paymentStatus === "pending" ? { stripePaymentIntentId: null } : {}),
    })
    .where(eq(registrations.id, reg.id));
  await writeAudit(
    {
      actorUserId: null,
      action: "payment.failed",
      targetType: "registration",
      targetId: reg.id,
      metadata: { eventId: event.id, sessionId: session.id, stripeAccountId: event.account ?? null },
    },
    tx,
  );
}

// ---------------------------------------------------------------------------
// Admin notification (best effort, after commit). Never auto-refunds.
// ---------------------------------------------------------------------------
async function adminRecipients(programId: string): Promise<{ email: string; name: string }[]> {
  const live = and(isNull(users.deletedAt), eq(users.emailBounced, false));
  const pa = await db
    .select({ email: users.email, name: users.name })
    .from(programRoles)
    .innerJoin(users, eq(users.id, programRoles.userId))
    .where(and(eq(programRoles.programId, programId), eq(programRoles.role, "program_admin"), live));
  if (pa.length > 0) return pa;
  return db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(and(inArray(users.orgRole, ["super_admin", "board_member"]), live));
}

let nuntly: Nuntly | null = null;

async function notifyAdminsRefundNeeded(reg: LoadedRegistration, reason: string, amountCents: number): Promise<void> {
  const to = await adminRecipients(reg.programId);
  if (to.length === 0) return;
  const link = `${appBase()}/programs/${reg.programSlug}/payments/ledger`;
  const subject = `Refund needed: ${reg.athleteName} (${reg.programName})`;
  const html = `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
    <h2>Refund needed</h2>
    <p>${escapeHtml(reason)}</p>
    <p><strong>${escapeHtml(reg.athleteName)}</strong>, ${escapeHtml(reg.programName)} - ${escapeHtml(reg.seasonName)}.
    A card payment of <strong>${escapeHtml(formatCents(amountCents))}</strong> was received and recorded in the payment ledger.
    GBYS did not refund it automatically.</p>
    <p><a href="${escapeHtml(link)}">Open the payment ledger</a></p></div>`;
  for (const r of to) {
    if (!process.env.NUNTLY_API_KEY) {
      console.log(`[EMAIL not sent: NUNTLY_API_KEY missing] to=${r.email} subject="${subject}"`);
      continue;
    }
    try {
      nuntly ??= new Nuntly({ apiKey: process.env.NUNTLY_API_KEY });
      await nuntly.emails.send({
        from: process.env.NUNTLY_FROM_EMAIL ?? "Gold Beach Youth Sports <noreply@goldbeachyouthsports.org>",
        to: r.email,
        subject,
        html,
      });
    } catch (err) {
      console.error("[stripe-webhook] refund-needed email failed", { message: (err as Error).message });
    }
  }
}
