import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { postPendingPayments } from "@/lib/dal/finance-autopost";
import { syncAllConnections } from "@/lib/dal/finance-banking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily finance job: post any registration payments the live hook missed, then pull
 * bank transactions from SimpleFIN (payout matching runs during the import).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  const m = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!m || !tokenMatches(m[1], secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const payments = await postPendingPayments();
    const bank = await syncAllConnections();
    return NextResponse.json({ payments, bank });
  } catch (err) {
    console.error("[cron-finance] failed", err);
    return NextResponse.json({ error: "Finance sync failed" }, { status: 500 });
  }
}
