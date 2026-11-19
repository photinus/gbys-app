import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users, webhookEvents } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

/**
 * Nuntly bounce webhook processing (system actor).
 *
 * The installed @nuntly/sdk (0.3.0) documents webhook creation and event names
 * (email.bounced, email.complained, ...) and returns a `signing_secret`, but
 * documents NO signature header or scheme. We therefore implement HMAC-SHA256
 * over the raw request body, keyed by NUNTLY_WEBHOOK_SECRET, accepted from the
 * `x-nuntly-signature` (or `nuntly-signature`) header as hex or base64,
 * optionally prefixed `sha256=`. Verify against Nuntly's docs before go-live.
 */
/** Nuntly's documented replay window for signed webhooks. */
export const NUNTLY_TOLERANCE_SECONDS = 5 * 60;

function macMatches(mac: Buffer, candidate: string): boolean {
  for (const enc of ["hex", "base64"] as const) {
    let buf: Buffer;
    try {
      buf = Buffer.from(candidate, enc);
    } catch {
      continue;
    }
    if (buf.length === mac.length && timingSafeEqual(buf, mac)) return true;
  }
  return false;
}

/**
 * Verifies a Nuntly webhook. Nuntly's documented header is
 * `webhook-signature: t=<unix seconds>,v0=<hex HMAC-SHA256>[,v0=...]` (several v0
 * values may be present during secret rotation) with a 5-minute tolerance.
 * The signed string is `${t}.${rawBody}`; an HMAC of the raw body alone is also
 * accepted in case Nuntly signs only the body. Both require the secret, and the
 * timestamp window is always enforced for the documented format. A bare legacy
 * hex/base64 signature (optionally `sha256=`-prefixed) is still accepted.
 */
export function verifyNuntlySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!header) return false;
  const value = header.trim();
  const parts = value.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith("v0=")).map((p) => p.slice(3)).filter(Boolean);
  if (t !== undefined || sigs.length) {
    const ts = Number(t);
    if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > NUNTLY_TOLERANCE_SECONDS) return false;
    const signedTs = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
    const signedBody = createHmac("sha256", secret).update(rawBody).digest();
    return sigs.some((sig) => macMatches(signedTs, sig) || macMatches(signedBody, sig));
  }
  let candidate = value;
  if (candidate.toLowerCase().startsWith("sha256=")) candidate = candidate.slice(7);
  return macMatches(createHmac("sha256", secret).update(rawBody).digest(), candidate);
}

const BOUNCE_TYPES = new Set(["email.bounced", "email.complained"]);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Recipient addresses from a payload, tolerant of the likely shapes (to / recipient / email, string or list). */
function recipientsOf(data: unknown): string[] {
  if (!isObj(data)) return [];
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (isObj(v) && typeof v.email === "string") out.push(v.email);
    else if (isObj(v) && typeof v.address === "string") out.push(v.address);
  };
  for (const k of ["to", "recipient", "recipients", "email", "bounced_recipients"]) add(data[k]);
  const bounce = data.bounce;
  if (isObj(bounce)) for (const k of ["recipients", "recipient", "to"]) add(bounce[k]);
  return [...new Set(out.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e)))];
}

export type NuntlyResult =
  | { status: "processed"; marked: number }
  | { status: "duplicate" }
  | { status: "ignored" };

export async function processNuntlyEvent(rawBody: string): Promise<NuntlyResult> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: "ignored" };
  }
  if (!isObj(payload)) return { status: "ignored" };
  const type = typeof payload.type === "string" ? payload.type : typeof payload.event === "string" ? payload.event : "";
  if (!type) return { status: "ignored" };
  const eventId =
    typeof payload.id === "string" && payload.id
      ? payload.id
      : `body:${createHash("sha256").update(rawBody).digest("hex")}`;
  const data = isObj(payload.data) ? payload.data : payload;

  return db.transaction(async (tx): Promise<NuntlyResult> => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ id: `nuntly:${eventId}`, provider: "nuntly", eventType: type })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return { status: "duplicate" };
    if (!BOUNCE_TYPES.has(type)) return { status: "processed", marked: 0 }; // delivered etc.: no-op

    let marked = 0;
    for (const email of recipientsOf(data)) {
      const rows = await tx
        .update(users)
        .set({ emailBounced: true })
        .where(sql`lower(${users.email}) = ${email} and ${users.emailBounced} = false`)
        .returning({ id: users.id });
      for (const u of rows) {
        marked++;
        await writeAudit(
          {
            actorUserId: null,
            action: "user.email_bounced",
            targetType: "user",
            targetId: u.id,
            metadata: { eventId, eventType: type },
          },
          tx,
        );
      }
    }
    return { status: "processed", marked };
  });
}
