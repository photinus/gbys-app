import { NextResponse } from "next/server";
import { processNuntlyEvent, verifyNuntlySignature } from "@/lib/dal/nuntly-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nuntly delivery events. 503 without NUNTLY_WEBHOOK_SECRET; 400 bad signature; 500 -> Nuntly retries. */
export async function POST(req: Request) {
  // Nuntly docs call it NUNTLY_WEBHOOK_SIGNING_SECRET; NUNTLY_WEBHOOK_SECRET is kept for compatibility.
  const secret = process.env.NUNTLY_WEBHOOK_SIGNING_SECRET || process.env.NUNTLY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Nuntly webhooks are not configured." }, { status: 503 });

  const body = await req.text();
  const sig =
    req.headers.get("webhook-signature") ?? req.headers.get("x-nuntly-signature") ?? req.headers.get("nuntly-signature");
  if (!verifyNuntlySignature(body, sig, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  try {
    const result = await processNuntlyEvent(body);
    return NextResponse.json({ received: true, ...(result.status === "duplicate" ? { duplicate: true } : {}) });
  } catch (err) {
    console.error("[nuntly-webhook] processing failed", { message: (err as Error).message });
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
