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
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (s): s is string => !!s,
  );
  if (secrets.length === 0) {
    return NextResponse.json({ error: "Stripe webhooks are not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const body = await req.text(); // raw body: the signature covers the exact bytes

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = Stripe.webhooks.constructEvent(body, signature, secret);
      break;
    } catch {
      /* try the next secret */
    }
  }
  if (!event) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });

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
