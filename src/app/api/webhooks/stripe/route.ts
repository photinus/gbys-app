import Stripe from "stripe";
import { NextResponse } from "next/server";
import { processStripeEvent } from "@/lib/dal/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Two endpoints in the Stripe dashboard point here (platform
 * "Your account" events and "Connected accounts" events), each with its own
 * signing secret, so we accept a signature valid for either secret.
 *   400 bad/missing signature or unparseable body   503 no secret configured
 *   200 processed | duplicate | refused (never retryable)   500 error -> Stripe retries
 * Only event id and type are ever logged, never payloads.
 */
export async function POST(req: Request) {
  const platformSecret = process.env.STRIPE_WEBHOOK_SECRET || null;
  const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || null;
  const secrets = [
    { secret: platformSecret, via: "platform" as const },
    { secret: connectSecret, via: "connect" as const },
  ].filter((s): s is { secret: string; via: "platform" | "connect" } => !!s.secret);
  if (secrets.length === 0) {
    return NextResponse.json({ error: "Stripe webhooks are not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const body = await req.text(); // raw body: the signature covers the exact bytes

  let event: Stripe.Event | null = null;
  let via: "platform" | "connect" | null = null;
  for (const s of secrets) {
    try {
      event = Stripe.webhooks.constructEvent(body, signature, s.secret);
      via = s.via;
      break;
    } catch {
      /* try the next secret */
    }
  }
  if (!event) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });

  // Platform-endpoint events never carry `account`; Connect-endpoint events always do. An event whose
  // signature says one thing and whose payload says the other is forged or misrouted: refuse it
  // (200, a retry could never succeed). Skipped when one secret is deliberately used for both.
  if (platformSecret && connectSecret && platformSecret !== connectSecret) {
    if ((via === "platform" && event.account) || (via === "connect" && !event.account)) {
      console.error("[stripe-webhook] event refused", { eventId: event.id, type: event.type, reason: "signing secret does not match event account scope" });
      return NextResponse.json({ received: true, refused: true });
    }
  }

  try {
    const result = await processStripeEvent(event);
    if (result.status === "duplicate") return NextResponse.json({ received: true, duplicate: true });
    if (result.status === "refused") return NextResponse.json({ received: true, refused: true });
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] processing failed", { eventId: event.id, type: event.type, message: (err as Error).message });
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
