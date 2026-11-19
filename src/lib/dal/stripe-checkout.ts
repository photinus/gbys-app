import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import { athletes, auditLogs, householdGuardians, programs, registrations, seasons } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { computePlatformFeeCents, getStripe, paymentRouteFor, stripeRequestOptions } from "@/lib/stripe";
import { DalError, type SessionContext } from "./context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_TTL_SECONDS = 60 * 60; // 1 hour
/** A reused session must have at least this long left, or the parent could land on an expired page. */
const REUSE_MIN_REMAINING_SECONDS = 5 * 60;

function appBase(): string {
  return (process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function isIdempotencyError(err: unknown): boolean {
  return (err as { type?: string } | null)?.type === "StripeIdempotencyError";
}

/**
 * Starts (or resumes) a Stripe-hosted Checkout for a registration and returns
 * its URL. Guardian with canRegister only. Nothing is marked paid here: only
 * the verified webhook does that.
 */
export async function createCheckoutForRegistration(
  ctx: SessionContext,
  registrationId: string,
): Promise<{ url: string }> {
  if (!UUID_RE.test(registrationId)) throw new DalError("NOT_FOUND", "That registration was not found.");

  // The row lock serializes double-clicks: the second caller waits, then reuses the first one's session.
  return db.transaction(async (tx) => {
    const [reg] = await tx
      .select({
        id: registrations.id,
        athleteId: registrations.athleteId,
        seasonId: registrations.seasonId,
        feeCents: registrations.feeCents,
        paymentStatus: registrations.paymentStatus,
        deletedAt: registrations.deletedAt,
        sessionId: registrations.stripeCheckoutSessionId,
        accountSnapshot: registrations.stripeAccountId,
      })
      .from(registrations)
      .where(eq(registrations.id, registrationId))
      .for("update")
      .limit(1);

    const [link] = reg
      ? await tx
          .select({ canRegister: householdGuardians.canRegister })
          .from(householdGuardians)
          .where(and(eq(householdGuardians.athleteId, reg.athleteId), eq(householdGuardians.userId, ctx.userId)))
          .limit(1)
      : [];
    // Not a guardian: indistinguishable from "does not exist".
    if (!reg || !link) throw new DalError("NOT_FOUND", "That registration was not found.");
    if (!link.canRegister) throw new DalError("FORBIDDEN", "You are not allowed to pay for this athlete's registration.");
    if (reg.deletedAt) throw new DalError("INVALID", "That registration was cancelled.");
    if (reg.paymentStatus === "pending")
      throw new DalError("INVALID", "A payment for this registration is still processing. Check back in a few minutes.");
    if (reg.paymentStatus !== "unpaid") throw new DalError("INVALID", "This registration does not have a balance due.");
    if (reg.feeCents <= 0) throw new DalError("INVALID", "This registration does not have a balance due.");

    const [ctxRow] = await tx
      .select({
        seasonName: seasons.name,
        programId: programs.id,
        programName: programs.name,
        isIndependentPartner: programs.isIndependentPartner,
        stripeAccountId: programs.stripeAccountId,
        stripeOnboardingComplete: programs.stripeOnboardingComplete,
        platformFeeCents: programs.platformFeeCents,
        platformFeeBps: programs.platformFeeBps,
        athleteFirstName: athletes.firstName,
      })
      .from(seasons)
      .innerJoin(programs, eq(programs.id, seasons.programId))
      .innerJoin(athletes, eq(athletes.id, reg.athleteId))
      .where(eq(seasons.id, reg.seasonId))
      .limit(1);
    if (!ctxRow) throw new DalError("NOT_FOUND", "That registration was not found.");

    const route = paymentRouteFor(ctxRow);
    if (!route.ready) throw new DalError("INVALID", "Online payment is not available for this program. Pay by cash or check.");
    const acct = route.stripeAccountId;
    const stripe = getStripe();

    // Reuse a still-open session (same account) instead of stacking up sessions.
    if (reg.sessionId && (reg.accountSnapshot ?? null) === acct) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(reg.sessionId, {}, stripeRequestOptions(acct));
        if (
          existing.status === "open" &&
          existing.url &&
          existing.expires_at * 1000 > Date.now() + REUSE_MIN_REMAINING_SECONDS * 1000
        ) {
          return { url: existing.url };
        }
        if (existing.status === "complete")
          throw new DalError("INVALID", "A payment for this registration is already being processed.");
      } catch (err) {
        if (err instanceof DalError) throw err;
        // Unknown or unreadable session: fall through and create a fresh one.
        console.warn("[checkout] could not reuse session", { registrationId });
      }
    }

    const platformFee = computePlatformFeeCents(reg.feeCents, ctxRow);
    const [{ n: attemptsSoFar }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "payment.checkout_started"),
          eq(auditLogs.targetType, "registration"),
          eq(auditLogs.targetId, reg.id),
        ),
      );
    const attempt = attemptsSoFar + 1;
    const base = appBase();
    const metadata = { registrationId: reg.id, programId: ctxRow.programId, seasonId: reg.seasonId };
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: reg.feeCents,
            product_data: {
              name: `${ctxRow.seasonName} registration — ${ctxRow.athleteFirstName}`,
              description: ctxRow.programName,
            },
          },
        },
      ],
      customer_email: ctx.email,
      client_reference_id: reg.id,
      metadata,
      payment_intent_data: {
        metadata,
        ...(platformFee > 0 ? { application_fee_amount: platformFee } : {}),
      },
      success_url: `${base}/registrations?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/registrations?checkout=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };

    const create = (key: string) =>
      stripe.checkout.sessions.create(params, { ...stripeRequestOptions(acct), idempotencyKey: key });
    let session: Stripe.Checkout.Session;
    try {
      session = await create(`checkout:${reg.id}:${attempt}`);
    } catch (err) {
      // A previous attempt created a session but crashed before we stored it (different expires_at).
      if (!isIdempotencyError(err)) throw err;
      session = await create(`checkout:${reg.id}:${attempt}:${Date.now()}`);
    }
    if (!session.url) throw new DalError("INVALID", "Could not start checkout. Please try again.");

    await tx
      .update(registrations)
      .set({
        stripeCheckoutSessionId: session.id,
        stripeAccountId: acct,
        platformFeeChargedCents: acct ? platformFee : null,
      })
      .where(eq(registrations.id, reg.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "payment.checkout_started",
        targetType: "registration",
        targetId: reg.id,
        metadata: { sessionId: session.id, amountCents: reg.feeCents, stripeAccountId: acct, platformFeeCents: acct ? platformFee : 0, attempt },
      },
      tx,
    );
    return { url: session.url };
  });
}
